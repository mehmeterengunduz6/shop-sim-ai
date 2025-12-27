'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Finding {
  id: string;
  category: 'critical' | 'warning' | 'suggestion';
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
}

interface TimelineEvent {
  timestamp: string;
  action: string;
  url: string;
  success: boolean;
}

interface RunResult {
  run_id: string;
  store_url: string;
  status: 'running' | 'completed' | 'failed';
  score?: number;
  metrics?: {
    add_to_cart_success: boolean;
    time_to_add_to_cart_seconds: number | null;
    checkout_reached: boolean;
    drop_off_step: string | null;
  };
  findings?: Finding[];
  timeline?: TimelineEvent[];
  session_url?: string | null;
  error?: string;
}

export default function RunPage() {
  const params = useParams();
  const runId = params.id as string;
  const [result, setResult] = useState<RunResult | null>(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!polling) return;

    const poll = async () => {
      try {
        const response = await fetch(`/api/run/${runId}`);
        const data = await response.json();
        
        setResult(data);

        if (data.status !== 'running') {
          setPolling(false);
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [runId, polling]);

  // Loading state
  if (!result || result.status === 'running') {
    return (
      <div className="min-h-screen bg-[#fafafa] px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/" className="text-[#f97316] hover:underline text-sm mb-6 inline-block">
            ← Back to home
          </Link>
          
          <div className="bg-white rounded-2xl shadow-lg p-8">
            <h1 className="text-2xl font-semibold text-gray-900 mb-4">
              Analysis in Progress
            </h1>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="animate-spin h-5 w-5 border-2 border-[#f97316] border-t-transparent rounded-full" />
              <span className="text-gray-600">AI agent is analyzing your store...</span>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-500 mb-1">Run ID</p>
              <p className="font-mono text-sm text-gray-800">{runId}</p>
            </div>

            <div className="space-y-3 text-sm text-gray-500">
              <p>🔍 Navigating to your store</p>
              <p>🛒 Finding products and testing add-to-cart</p>
              <p>💳 Attempting checkout flow</p>
              <p>📊 Generating UX analysis report</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (result.status === 'failed' && result.error) {
    return (
      <div className="min-h-screen bg-[#fafafa] px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <Link href="/" className="text-[#f97316] hover:underline text-sm mb-6 inline-block">
            ← Back to home
          </Link>
          
          <div className="bg-white rounded-2xl shadow-lg p-8">
            <h1 className="text-2xl font-semibold text-red-600 mb-4">
              Analysis Failed
            </h1>
            <p className="text-gray-600 mb-4">{result.error}</p>
            <Link
              href="/"
              className="inline-block bg-[#f97316] text-white px-6 py-2 rounded-full hover:bg-[#ea580c] transition"
            >
              Try Again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Results
  const { score, metrics, findings, timeline, session_url, store_url } = result;

  return (
    <div className="min-h-screen bg-[#fafafa] px-4 py-12">
      <div className="max-w-4xl mx-auto">
        <Link href="/" className="text-[#f97316] hover:underline text-sm mb-6 inline-block">
          ← Analyze another store
        </Link>

        {/* Score Card */}
        <div className="bg-white rounded-2xl shadow-lg p-8 mb-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900 mb-1">
                Analysis Complete
              </h1>
              <p className="text-gray-500">{store_url}</p>
            </div>
            <div className="text-right">
              <div className={`text-5xl font-bold ${
                (score ?? 0) >= 70 ? 'text-green-500' : 
                (score ?? 0) >= 40 ? 'text-yellow-500' : 'text-red-500'
              }`}>
                {score}
              </div>
              <p className="text-gray-500 text-sm">Checkout Score</p>
            </div>
          </div>

          {session_url && (
            <a
              href={session_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#f97316] hover:underline text-sm"
            >
              View session recording →
            </a>
          )}
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow">
            <div className={`text-2xl font-semibold ${metrics?.add_to_cart_success ? 'text-green-500' : 'text-red-500'}`}>
              {metrics?.add_to_cart_success ? '✓' : '✗'}
            </div>
            <p className="text-gray-500 text-sm">Add to Cart</p>
          </div>
          
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="text-2xl font-semibold text-gray-900">
              {metrics?.time_to_add_to_cart_seconds ?? '-'}s
            </div>
            <p className="text-gray-500 text-sm">Time to Cart</p>
          </div>
          
          <div className="bg-white rounded-xl p-4 shadow">
            <div className={`text-2xl font-semibold ${metrics?.checkout_reached ? 'text-green-500' : 'text-red-500'}`}>
              {metrics?.checkout_reached ? '✓' : '✗'}
            </div>
            <p className="text-gray-500 text-sm">Checkout Reached</p>
          </div>
          
          <div className="bg-white rounded-xl p-4 shadow">
            <div className="text-2xl font-semibold text-gray-900">
              {metrics?.drop_off_step ?? 'None'}
            </div>
            <p className="text-gray-500 text-sm">Drop-off Step</p>
          </div>
        </div>

        {/* Findings */}
        {findings && findings.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Findings</h2>
            <div className="space-y-4">
              {findings.map((finding) => (
                <div
                  key={finding.id}
                  className={`p-4 rounded-lg border-l-4 ${
                    finding.category === 'critical' ? 'bg-red-50 border-red-500' :
                    finding.category === 'warning' ? 'bg-yellow-50 border-yellow-500' :
                    'bg-green-50 border-green-500'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className={`text-xs font-medium uppercase ${
                        finding.category === 'critical' ? 'text-red-600' :
                        finding.category === 'warning' ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {finding.category}
                      </span>
                      <h3 className="font-medium text-gray-900 mt-1">{finding.title}</h3>
                      <p className="text-gray-600 text-sm mt-1">{finding.description}</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <p className="text-sm text-gray-500">
                      <span className="font-medium">Recommendation:</span> {finding.recommendation}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {timeline && timeline.length > 0 && (
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Activity Timeline</h2>
            <div className="space-y-3">
              {timeline.map((event, index) => (
                <div key={index} className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 ${event.success ? 'bg-green-500' : 'bg-red-500'}`} />
                  <div>
                    <p className="text-gray-900">{event.action}</p>
                    <p className="text-gray-500 text-sm">{event.url}</p>
                    <p className="text-gray-400 text-xs">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
