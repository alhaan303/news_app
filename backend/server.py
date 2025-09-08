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

class NewsConfig(BaseModel):
    category: str = "technology"
    country: str = "us"
    language: str = "en"
    max_articles: int = 10

# Global variables for background task control
background_task_running = False
news_config = NewsConfig()

# News API Configuration
NEWS_API_KEY = os.environ.get('NEWS_API_KEY', 'demo_key')  # Users need to provide this
NEWS_API_BASE_URL = "https://newsapi.org/v2"

# AI Configuration  
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

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
        1. Must be under 240 characters (leaving room for URL)
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
            
            # Small delay to avoid overwhelming the AI API
            await asyncio.sleep(1)
            
        except Exception as e:
            logger.error(f"Error processing article: {e}")
            continue
    
    logger.info(f"Processed {processed_count} new articles")
    return processed_count

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
                processed_count = await process_articles(articles_data, news_config)
                logger.info(f"Pipeline cycle complete. Processed {processed_count} new articles.")
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
    return {
        "running": background_task_running,
        "total_articles": article_count,
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
            return {"message": "No articles fetched", "processed": 0}
            
        processed_count = await process_articles(articles_data, news_config)
        return {"message": "Manual processing complete", "processed": processed_count}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in manual processing: {e}")
        raise HTTPException(status_code=500, detail="Error processing articles")

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