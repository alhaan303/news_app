from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone
import httpx
import json
import tweepy
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="AI News Hub API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Models
class NewsArticle(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str
    content: Optional[str] = None
    url: str
    published_at: datetime
    source: str
    category: str = "general"
    ai_summary: Optional[str] = None
    ai_social_post: Optional[str] = None
    image_url: Optional[str] = None
    processed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    twitter_posted: bool = False
    twitter_post_id: Optional[str] = None
    twitter_posted_at: Optional[datetime] = None

class NewsConfig(BaseModel):
    category: str = "technology"
    country: str = "us"
    language: str = "en"
    max_articles: int = 10
    auto_tweet: bool = False

class TwitterPostRequest(BaseModel):
    article_id: str

# Global variables for background task control
background_task_running = False
news_config = NewsConfig()

# News API Configuration
NEWS_API_KEY = os.environ.get('NEWS_API_KEY', 'demo_key')
NEWS_API_BASE_URL = "https://newsapi.org/v2"

# AI Configuration  
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

# Twitter API Configuration
TWITTER_API_KEY = os.environ.get('TWITTER_API_KEY')
TWITTER_API_SECRET = os.environ.get('TWITTER_API_SECRET')
TWITTER_ACCESS_TOKEN = os.environ.get('TWITTER_ACCESS_TOKEN')
TWITTER_ACCESS_TOKEN_SECRET = os.environ.get('TWITTER_ACCESS_TOKEN_SECRET')

def get_twitter_client():
    """Initialize Twitter API client"""
    if not all([TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET]):
        return None
    
    try:
        # Twitter API v2 client
        client = tweepy.Client(
            consumer_key=TWITTER_API_KEY,
            consumer_secret=TWITTER_API_SECRET,
            access_token=TWITTER_ACCESS_TOKEN,
            access_token_secret=TWITTER_ACCESS_TOKEN_SECRET
        )
        return client
    except Exception as e:
        logger.error(f"Error initializing Twitter client: {e}")
        return None

async def post_to_twitter(article: NewsArticle) -> bool:
    """Post article to Twitter"""
    try:
        twitter_client = get_twitter_client()
        if not twitter_client:
            logger.error("Twitter client not initialized - missing credentials")
            return False
            
        # Create tweet text with article link
        tweet_text = f"{article.ai_social_post}\n\n{article.url}"
        
        # Ensure tweet is under 280 characters
        if len(tweet_text) > 280:
            # Truncate social post to fit URL
            max_post_length = 280 - len(article.url) - 3  # 3 for \n\n
            truncated_post = article.ai_social_post[:max_post_length-3] + "..."
            tweet_text = f"{truncated_post}\n\n{article.url}"
        
        # Post tweet
        response = twitter_client.create_tweet(text=tweet_text)
        
        if response.data:
            # Update article with Twitter info
            await db.articles.update_one(
                {"id": article.id},
                {
                    "$set": {
                        "twitter_posted": True,
                        "twitter_post_id": str(response.data['id']),
                        "twitter_posted_at": datetime.now(timezone.utc)
                    }
                }
            )
            logger.info(f"Posted to Twitter: {article.title[:50]}... - Tweet ID: {response.data['id']}")
            return True
        else:
            logger.error(f"Failed to post to Twitter: {response}")
            return False
            
    except Exception as e:
        logger.error(f"Error posting to Twitter: {e}")
        return False

async def fetch_news_from_api(config: NewsConfig) -> List[dict]:
    """Fetch news articles from NewsAPI"""
    try:
        url = f"{NEWS_API_BASE_URL}/top-headlines"
        params = {
            "apiKey": NEWS_API_KEY,
            "category": config.category,
            "country": config.country,
            "language": config.language,
            "pageSize": config.max_articles
        }
        
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
            
            if data.get("status") == "ok":
                return data.get("articles", [])
            else:
                logger.error(f"News API error: {data}")
                return []
                
    except Exception as e:
        logger.error(f"Error fetching news: {e}")
        return []

async def generate_ai_content(title: str, description: str) -> tuple[str, str]:
    """Generate AI summary and social media post using Gemini"""
    try:
        # Initialize Gemini chat
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"news-{uuid.uuid4()}",
            system_message="You are an expert content creator and social media manager specializing in news summarization."
        ).with_model("gemini", "gemini-2.0-flash")
        
        # Generate summary
        summary_prompt = f"""
        Create a concise, engaging summary of this news article in 2-3 sentences. 
        Make it informative and easy to understand.
        
        Title: {title}
        Description: {description}
        
        Provide only the summary text, no additional formatting or labels.
        """
        
        summary_message = UserMessage(text=summary_prompt)
        summary_response = await chat.send_message(summary_message)
        
        # Generate social media post
        social_prompt = f"""
        Create an engaging social media post for this news article. Follow these rules:
        1. Must be under 200 characters (leaving room for URL)
        2. Include 2-3 relevant hashtags
        3. Be engaging and informative
        4. Use a professional but accessible tone
        5. Provide ONLY the post text, no extra formatting or labels
        
        Title: {title}
        Description: {description}
        """
        
        # Use a new session for the social post
        social_chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"social-{uuid.uuid4()}",
            system_message="You are a social media expert creating engaging posts."
        ).with_model("gemini", "gemini-2.0-flash")
        
        social_message = UserMessage(text=social_prompt)
        social_response = await social_chat.send_message(social_message)
        
        return summary_response.strip(), social_response.strip()
        
    except Exception as e:
        logger.error(f"Error generating AI content: {e}")
        return f"AI-generated summary for: {title}", f"Check out this news: {title} #News #Breaking"

async def process_articles(articles_data: List[dict], config: NewsConfig):
    """Process raw articles data and save to database"""
    processed_count = 0
    posted_count = 0
    
    for article_data in articles_data:
        try:
            # Skip articles without title or URL
            if not article_data.get('title') or not article_data.get('url'):
                continue
                
            # Check if article already exists
            existing = await db.articles.find_one({"url": article_data['url']})
            if existing:
                continue
            
            # Generate AI content
            ai_summary, ai_social_post = await generate_ai_content(
                article_data['title'], 
                article_data.get('description', '')
            )
            
            # Create article object
            article = NewsArticle(
                title=article_data['title'],
                description=article_data.get('description', ''),
                content=article_data.get('content', ''),
                url=article_data['url'],
                published_at=datetime.fromisoformat(article_data['publishedAt'].replace('Z', '+00:00')),
                source=article_data.get('source', {}).get('name', 'Unknown'),
                category=config.category,
                ai_summary=ai_summary,
                ai_social_post=ai_social_post,
                image_url=article_data.get('urlToImage')
            )
            
            # Save to database
            await db.articles.insert_one(article.dict())
            processed_count += 1
            logger.info(f"Processed article: {article.title[:50]}...")
            
            # Post to Twitter if auto-tweet is enabled
            if config.auto_tweet:
                success = await post_to_twitter(article)
                if success:
                    posted_count += 1
                    logger.info(f"Posted to Twitter: {article.title[:50]}...")
                
                # Small delay between tweets
                await asyncio.sleep(2)
            
            # Small delay to avoid overwhelming the AI API
            await asyncio.sleep(1)
            
        except Exception as e:
            logger.error(f"Error processing article: {e}")
            continue
    
    logger.info(f"Processed {processed_count} new articles, posted {posted_count} to Twitter")
    return processed_count, posted_count

async def news_pipeline_task():
    """Background task to continuously fetch and process news"""
    global background_task_running
    
    while background_task_running:
        try:
            logger.info("Starting news pipeline cycle...")
            
            # Fetch news
            articles_data = await fetch_news_from_api(news_config)
            logger.info(f"Fetched {len(articles_data)} articles from API")
            
            if articles_data:
                # Process articles
                processed_count, posted_count = await process_articles(articles_data, news_config)
                logger.info(f"Pipeline cycle complete. Processed {processed_count} new articles, posted {posted_count} to Twitter.")
            else:
                logger.warning("No articles fetched from API")
            
            # Wait before next cycle (30 minutes)
            await asyncio.sleep(1800)
            
        except Exception as e:
            logger.error(f"Error in news pipeline: {e}")
            await asyncio.sleep(300)  # Wait 5 minutes on error

# API Routes
@api_router.get("/")
async def root():
    return {"message": "AI News Hub API", "status": "running"}

@api_router.get("/articles", response_model=List[NewsArticle])
async def get_articles(limit: int = 20, category: Optional[str] = None):
    """Get processed news articles"""
    try:
        query = {}
        if category:
            query["category"] = category
            
        articles = await db.articles.find(query).sort("processed_at", -1).limit(limit).to_list(length=None)
        return [NewsArticle(**article) for article in articles]
    except Exception as e:
        logger.error(f"Error fetching articles: {e}")
        raise HTTPException(status_code=500, detail="Error fetching articles")

@api_router.get("/articles/{article_id}", response_model=NewsArticle)
async def get_article(article_id: str):
    """Get a specific article by ID"""
    try:
        article = await db.articles.find_one({"id": article_id})
        if not article:
            raise HTTPException(status_code=404, detail="Article not found")
        return NewsArticle(**article)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching article: {e}")
        raise HTTPException(status_code=500, detail="Error fetching article")

@api_router.post("/pipeline/start")
async def start_pipeline(background_tasks: BackgroundTasks):
    """Start the news processing pipeline"""
    global background_task_running
    
    if background_task_running:
        return {"message": "Pipeline is already running"}
    
    # Check if API key is configured
    if NEWS_API_KEY == 'demo_key':
        raise HTTPException(
            status_code=400, 
            detail="NEWS_API_KEY not configured. Please add your NewsAPI key to the .env file"
        )
    
    background_task_running = True
    background_tasks.add_task(news_pipeline_task)
    return {"message": "News pipeline started"}

@api_router.post("/pipeline/stop")
async def stop_pipeline():
    """Stop the news processing pipeline"""
    global background_task_running
    background_task_running = False
    return {"message": "News pipeline stopped"}

@api_router.get("/pipeline/status")
async def pipeline_status():
    """Get pipeline status"""
    article_count = await db.articles.count_documents({})
    twitter_posted_count = await db.articles.count_documents({"twitter_posted": True})
    
    # Check if Twitter is configured
    twitter_configured = all([TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET])
    
    return {
        "running": background_task_running,
        "total_articles": article_count,
        "twitter_posts": twitter_posted_count,
        "twitter_configured": twitter_configured,
        "config": news_config.dict()
    }

@api_router.post("/config")
async def update_config(config: NewsConfig):
    """Update news fetching configuration"""
    global news_config
    news_config = config
    return {"message": "Configuration updated", "config": news_config.dict()}

@api_router.post("/process-manual")
async def manual_process():
    """Manually trigger news processing (for testing)"""
    try:
        if NEWS_API_KEY == 'demo_key':
            raise HTTPException(
                status_code=400, 
                detail="NEWS_API_KEY not configured. Please add your NewsAPI key to the .env file"
            )
            
        articles_data = await fetch_news_from_api(news_config)
        if not articles_data:
            return {"message": "No articles fetched", "processed": 0, "posted": 0}
            
        processed_count, posted_count = await process_articles(articles_data, news_config)
        return {"message": "Manual processing complete", "processed": processed_count, "posted": posted_count}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in manual processing: {e}")
        raise HTTPException(status_code=500, detail="Error processing articles")

@api_router.post("/twitter/post")
async def post_article_to_twitter(request: TwitterPostRequest):
    """Manually post a specific article to Twitter"""
    try:
        # Check if Twitter is configured
        if not get_twitter_client():
            raise HTTPException(
                status_code=400,
                detail="Twitter API not configured. Please add Twitter credentials to .env file"
            )
        
        # Get article
        article_data = await db.articles.find_one({"id": request.article_id})
        if not article_data:
            raise HTTPException(status_code=404, detail="Article not found")
        
        article = NewsArticle(**article_data)
        
        # Check if already posted
        if article.twitter_posted:
            return {"message": "Article already posted to Twitter", "twitter_post_id": article.twitter_post_id}
        
        # Post to Twitter
        success = await post_to_twitter(article)
        if success:
            # Get updated article
            updated_article_data = await db.articles.find_one({"id": request.article_id})
            updated_article = NewsArticle(**updated_article_data)
            return {
                "message": "Successfully posted to Twitter", 
                "twitter_post_id": updated_article.twitter_post_id
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to post to Twitter")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error posting to Twitter: {e}")
        raise HTTPException(status_code=500, detail="Error posting to Twitter")

@api_router.get("/twitter/status")
async def twitter_status():
    """Get Twitter configuration status"""
    twitter_configured = all([TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET])
    
    if not twitter_configured:
        return {
            "configured": False,
            "missing_keys": [
                key for key, val in {
                    "TWITTER_API_KEY": TWITTER_API_KEY,
                    "TWITTER_API_SECRET": TWITTER_API_SECRET,
                    "TWITTER_ACCESS_TOKEN": TWITTER_ACCESS_TOKEN,
                    "TWITTER_ACCESS_TOKEN_SECRET": TWITTER_ACCESS_TOKEN_SECRET
                }.items() if not val
            ]
        }
    
    # Test Twitter connection
    try:
        twitter_client = get_twitter_client()
        if twitter_client:
            # Try to get user info
            me = twitter_client.get_me()
            return {
                "configured": True,
                "connected": True,
                "username": me.data.username if me.data else "Unknown"
            }
    except Exception as e:
        return {
            "configured": True,
            "connected": False,
            "error": str(e)
        }

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    global background_task_running
    background_task_running = False
    client.close()