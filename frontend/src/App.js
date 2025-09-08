import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { Separator } from './components/ui/separator';
import { RefreshCw, Clock, ExternalLink, Sparkles, MessageCircle, TrendingUp, Twitter, Send, CheckCircle, AlertCircle } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ArticleCard = ({ article, onTwitterPost }) => {
  const [posting, setPosting] = useState(false);
  
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleTwitterPost = async () => {
    setPosting(true);
    await onTwitterPost(article.id);
    setPosting(false);
  };

  return (
    <Card className="group hover:shadow-xl transition-all duration-300 border-0 bg-gradient-to-br from-white to-gray-50/50 hover:from-white hover:to-blue-50/30 overflow-hidden">
      <div className="relative">
        {article.image_url && (
          <div className="relative h-48 overflow-hidden">
            <img 
              src={article.image_url} 
              alt={article.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </div>
        )}
        <Badge className="absolute top-3 right-3 bg-blue-600/90 hover:bg-blue-700 text-white border-0">
          {article.category}
        </Badge>
      </div>
      
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
          <span className="font-medium text-blue-600">{article.source}</span>
          <span>•</span>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{formatDate(article.published_at)}</span>
          </div>
        </div>
        
        <CardTitle className="text-lg leading-tight hover:text-blue-700 transition-colors duration-200 line-clamp-2">
          {article.title}
        </CardTitle>
        
        {article.description && (
          <CardDescription className="text-gray-600 line-clamp-2">
            {article.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="pt-0 space-y-4">
        {article.ai_summary && (
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg p-4 border-l-4 border-purple-400">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-semibold text-purple-700">AI Summary</span>
            </div>
            <p className="text-gray-700 text-sm leading-relaxed">{article.ai_summary}</p>
          </div>
        )}

        {article.ai_social_post && (
          <div className="bg-gradient-to-r from-green-50 to-teal-50 rounded-lg p-4 border-l-4 border-green-400">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-semibold text-green-700">Social Media Post</span>
            </div>
            <p className="text-gray-700 text-sm leading-relaxed italic">"{article.ai_social_post}"</p>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <a 
            href={article.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium text-sm transition-colors duration-200"
          >
            <span>Read Full Article</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          
          <div className="flex items-center gap-3">
            {article.twitter_posted ? (
              <div className="flex items-center gap-2 text-green-600 text-sm">
                <CheckCircle className="w-4 h-4" />
                <span>Posted</span>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleTwitterPost}
                disabled={posting}
                className="gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
              >
                {posting ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Twitter className="w-3 h-3" />
                )}
                {posting ? 'Posting...' : 'Tweet'}
              </Button>
            )}
            
            <div className="text-xs text-gray-500">
              Processed {formatDate(article.processed_at)}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const Stats = ({ articles, pipelineStatus, isLoading }) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-sm border animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-20 mb-2"></div>
            <div className="h-8 bg-gray-200 rounded w-16"></div>
          </div>
        ))}
      </div>
    );
  }

  const totalArticles = articles.length;
  const todayArticles = articles.filter(article => {
    const today = new Date().toDateString();
    const articleDate = new Date(article.processed_at).toDateString();
    return today === articleDate;
  }).length;

  const categories = [...new Set(articles.map(article => article.category))].length;
  const twitterPosts = articles.filter(article => article.twitter_posted).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
      <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-blue-100 text-sm font-medium">Total Articles</p>
            <p className="text-3xl font-bold">{totalArticles}</p>
          </div>
          <TrendingUp className="w-8 h-8 text-blue-200" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-green-500 to-green-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-green-100 text-sm font-medium">Today's Articles</p>
            <p className="text-3xl font-bold">{todayArticles}</p>
          </div>
          <Clock className="w-8 h-8 text-green-200" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-purple-100 text-sm font-medium">Categories</p>
            <p className="text-3xl font-bold">{categories}</p>
          </div>
          <Sparkles className="w-8 h-8 text-purple-200" />
        </div>
      </div>
      
      <div className="bg-gradient-to-br from-sky-500 to-sky-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sky-100 text-sm font-medium">Twitter Posts</p>
            <p className="text-3xl font-bold">{twitterPosts}</p>
          </div>
          <Twitter className="w-8 h-8 text-sky-200" />
        </div>
      </div>
    </div>
  );
};

function App() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [twitterStatus, setTwitterStatus] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchArticles = async () => {
    try {
      setError(null);
      const response = await axios.get(`${API}/articles?limit=20`);
      setArticles(response.data);
    } catch (err) {
      console.error('Error fetching articles:', err);
      setError('Failed to fetch articles. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchPipelineStatus = async () => {
    try {
      const response = await axios.get(`${API}/pipeline/status`);
      setPipelineStatus(response.data);
    } catch (err) {
      console.error('Error fetching pipeline status:', err);
    }
  };

  const fetchTwitterStatus = async () => {
    try {
      const response = await axios.get(`${API}/twitter/status`);
      setTwitterStatus(response.data);
    } catch (err) {
      console.error('Error fetching Twitter status:', err);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchArticles();
    await fetchPipelineStatus();
    await fetchTwitterStatus();
    setRefreshing(false);
  };

  const startPipeline = async () => {
    try {
      await axios.post(`${API}/pipeline/start`);
      await fetchPipelineStatus();
    } catch (err) {
      console.error('Error starting pipeline:', err);
    }
  };

  const processManual = async () => {
    try {
      setRefreshing(true);
      await axios.post(`${API}/process-manual`);
      await fetchArticles();
      await fetchPipelineStatus();
    } catch (err) {
      console.error('Error processing articles:', err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleTwitterPost = async (articleId) => {
    try {
      await axios.post(`${API}/twitter/post`, { article_id: articleId });
      // Refresh articles to show updated status
      await fetchArticles();
      await fetchPipelineStatus();
    } catch (err) {
      console.error('Error posting to Twitter:', err);
    }
  };

  useEffect(() => {
    fetchArticles();
    fetchPipelineStatus();
    fetchTwitterStatus();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50/30">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  AI News Hub
                </h1>
                <p className="text-sm text-gray-600">Intelligent news processing powered by AI</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {pipelineStatus && (
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${pipelineStatus.running ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <span className="text-sm text-gray-600">
                    Pipeline {pipelineStatus.running ? 'Running' : 'Stopped'}
                  </span>
                </div>
              )}
              
              {twitterStatus && (
                <div className="flex items-center gap-2">
                  <Twitter className={`w-4 h-4 ${twitterStatus.configured ? (twitterStatus.connected ? 'text-blue-500' : 'text-yellow-500') : 'text-gray-400'}`} />
                  <span className="text-sm text-gray-600">
                    Twitter {twitterStatus.configured ? (twitterStatus.connected ? 'Connected' : 'Config Error') : 'Not Setup'}
                  </span>
                </div>
              )}
              
              <Button 
                onClick={handleRefresh} 
                disabled={refreshing}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>

              <Button 
                onClick={processManual}
                disabled={refreshing}
                size="sm"
                className="gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <Sparkles className="w-4 h-4" />
                Process News
              </Button>

              <Button 
                onClick={startPipeline}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                Start Auto Pipeline
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Stats articles={articles} pipelineStatus={pipelineStatus} isLoading={loading} />

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="animate-pulse">
                <div className="h-48 bg-gray-200 rounded-t-lg" />
                <CardHeader>
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-3 bg-gray-200 rounded" />
                    <div className="h-3 bg-gray-200 rounded w-5/6" />
                    <div className="h-3 bg-gray-200 rounded w-4/6" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No articles yet</h3>
            <p className="text-gray-600 mb-6">Click "Process News" to fetch and process the latest articles with AI.</p>
            <Button 
              onClick={processManual}
              disabled={refreshing}
              className="gap-2 bg-blue-600 hover:bg-blue-700"
            >
              <Sparkles className="w-4 h-4" />
              Process First Articles
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} onTwitterPost={handleTwitterPost} />
            ))}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200/50 bg-white/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center text-gray-600">
            <p>Powered by AI • NewsAPI • Google Gemini</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;