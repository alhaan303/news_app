import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { RefreshCw, Clock, Sparkles, Twitter, TrendingUp, Settings, Play, Pause } from 'lucide-react';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ArticleCard = ({ article, onTwitterPost }) => {
  const [posting, setPosting] = useState(false);
  const [showTweet, setShowTweet] = useState(false);
  
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleTwitterPost = async () => {
    setPosting(true);
    await onTwitterPost(article.id);
    setPosting(false);
    setShowTweet(false);
  };

  return (
    <article className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden border border-gray-100">
      {article.image_url && (
        <div className="relative h-48 sm:h-56 overflow-hidden">
          <img 
            src={article.image_url} 
            alt={article.title}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <div className="absolute top-3 left-3">
            <Badge variant="secondary" className="bg-white/90 text-gray-800 text-xs">
              {article.category}
            </Badge>
          </div>
        </div>
      )}
      
      <div className="p-6">
        {/* Source and Date */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="font-medium">{article.source}</span>
            <span>•</span>
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>{formatDate(article.published_at)}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {article.twitter_posted && (
              <div className="flex items-center gap-1 text-blue-600">
                <Twitter className="w-3 h-3" />
                <span className="text-xs">Posted</span>
              </div>
            )}
            
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowTweet(!showTweet)}
              className="h-8 w-8 p-0 text-gray-400 hover:text-blue-600"
            >
              <Twitter className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Clickable Headline */}
        <h2 className="mb-4">
          <a 
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-bold text-gray-900 hover:text-blue-600 transition-colors duration-200 leading-tight block"
          >
            {article.title}
          </a>
        </h2>

        {/* AI-Generated Summary (no label) */}
        {article.ai_summary && (
          <p className="text-gray-700 leading-relaxed mb-4 text-base">
            {article.ai_summary}
          </p>
        )}

        {/* Tweet Dropdown */}
        {showTweet && article.ai_social_post && (
          <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="text-sm text-gray-700 italic mb-3">"{article.ai_social_post}"</p>
                <p className="text-xs text-gray-500">+ {article.url}</p>
              </div>
              <Button
                size="sm"
                onClick={handleTwitterPost}
                disabled={posting || article.twitter_posted}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {posting ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : article.twitter_posted ? (
                  'Posted'
                ) : (
                  'Tweet'
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
};

const CompactStats = ({ articles, pipelineStatus, twitterStatus, isLoading }) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-6">
        <div className="animate-pulse flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-200 rounded"></div>
          <div className="w-8 h-4 bg-gray-200 rounded"></div>
        </div>
        <div className="animate-pulse flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-200 rounded"></div>
          <div className="w-8 h-4 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  const totalArticles = articles.length;
  const twitterPosts = articles.filter(article => article.twitter_posted).length;

  return (
    <div className="flex items-center gap-6 text-sm text-gray-600">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4" />
        <span>{totalArticles} articles</span>
      </div>
      
      <div className="flex items-center gap-2">
        <Twitter className="w-4 h-4" />
        <span>{twitterPosts} posted</span>
      </div>
      
      {pipelineStatus && (
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${pipelineStatus.running ? 'bg-green-500' : 'bg-gray-400'}`} />
          <span>{pipelineStatus.running ? 'Running' : 'Stopped'}</span>
        </div>
      )}
      
      {twitterStatus && (
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${twitterStatus.configured ? (twitterStatus.connected ? 'bg-blue-500' : 'bg-yellow-500') : 'bg-gray-400'}`} />
          <span>Twitter {twitterStatus.configured ? (twitterStatus.connected ? 'OK' : 'Error') : 'Off'}</span>
        </div>
      )}
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
  const [showControls, setShowControls] = useState(false);

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

  const stopPipeline = async () => {
    try {
      await axios.post(`${API}/pipeline/stop`);
      await fetchPipelineStatus();
    } catch (err) {
      console.error('Error stopping pipeline:', err);
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
    <div className="min-h-screen bg-gray-50">
      {/* Refined Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Title */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">AI News Hub</h1>
              </div>
            </div>

            {/* Stats and Controls */}
            <div className="flex items-center gap-4">
              <CompactStats 
                articles={articles} 
                pipelineStatus={pipelineStatus} 
                twitterStatus={twitterStatus} 
                isLoading={loading} 
              />
              
              <div className="h-6 w-px bg-gray-200"></div>
              
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowControls(!showControls)}
                className="gap-2"
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Expandable Controls */}
          {showControls && (
            <div className="border-t border-gray-100 py-3">
              <div className="flex items-center gap-3">
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
                  className="gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  Process News
                </Button>

                <Button 
                  onClick={pipelineStatus?.running ? stopPipeline : startPipeline}
                  variant="outline"
                  size="sm"
                  className="gap-2"
                >
                  {pipelineStatus?.running ? (
                    <>
                      <Pause className="w-4 h-4" />
                      Stop Pipeline
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      Start Pipeline
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden animate-pulse">
                <div className="h-48 bg-gray-200" />
                <div className="p-6">
                  <div className="h-4 bg-gray-200 rounded w-1/4 mb-3" />
                  <div className="h-6 bg-gray-300 rounded w-3/4 mb-4" />
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded" />
                    <div className="h-4 bg-gray-200 rounded w-5/6" />
                    <div className="h-4 bg-gray-200 rounded w-4/6" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No articles yet</h3>
            <p className="text-gray-600 mb-6">Click the settings icon and "Process News" to fetch the latest articles.</p>
            <Button 
              onClick={processManual}
              disabled={refreshing}
              className="gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Process First Articles
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} onTwitterPost={handleTwitterPost} />
            ))}
          </div>
        )}
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
          <div className="text-center text-sm text-gray-500">
            <p>Powered by AI • Intelligent news processing and social media automation</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;