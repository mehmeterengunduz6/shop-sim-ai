'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WarpBackground } from "@/components/ui/warp-background";

export default function HomePage() {
  const router = useRouter();
  const [storeUrl, setStoreUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!storeUrl) {
      setError('Please enter a store URL');
      return;
    }

    // Validate URL
    let url = storeUrl;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    try {
      new URL(url);
    } catch {
      setError('Please enter a valid URL');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/run/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          store_url: url,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to start analysis');
        return;
      }

      router.push(`/run/${data.run_id}`);
    } catch {
      setError('Failed to connect to server. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative">
      <WarpBackground
        className="min-h-screen w-full overflow-hidden border-none"
        gridColor="rgba(0,0,0,0.05)"
        perspective={80}
        beamDuration={2}
        beamsPerSide={1}
      >
        <div className="flex flex-col items-center justify-center min-h-screen px-4">
          <div className="flex flex-col items-center justify-center py-16 px-4 md:px-8 relative z-10 bg-white rounded-xl shadow-lg max-w-3xl w-full">
            {/* Badge */}
            <div className="flex items-center gap-2 mb-6 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full border border-gray-200 shadow-sm">
              <span className="text-sm font-medium text-gray-700">UX Analysis</span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-400"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 16 16 12 12 8" />
                <line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </div>

            {/* Heading */}
            <h1 className="text-5xl md:text-6xl font-semibold text-center text-gray-900 leading-tight mb-6">
              Is your store<br />
              <span className="text-[#f97316]">Checkout Ready?</span>
            </h1>

            {/* Description */}
            <p className="text-center text-gray-600 text-lg max-w-lg mb-2">
              Analyze how checkout-ready your e-commerce store is from a single page snapshot. High-signal metrics for conversion optimization.
            </p>

            {/* Powered by */}
            <p className="text-center text-gray-500 text-sm mb-8">
              Powered by AI Agents.
            </p>

            {/* URL Input */}
            <form onSubmit={handleSubmit} className="w-full max-w-xl">
              <div className="flex items-center gap-3 bg-white/90 backdrop-blur-sm rounded-full border border-gray-200 shadow-lg px-5 py-3 transition-all focus-within:ring-2 focus-within:ring-[#f97316]/20">
                {/* Globe Icon */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-gray-400 flex-shrink-0"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>

                <input
                  type="text"
                  placeholder="example-store.com"
                  value={storeUrl}
                  onChange={(e) => setStoreUrl(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-gray-800 text-lg placeholder:text-gray-400"
                  disabled={isSubmitting}
                />

                <button
                  type="submit"
                  disabled={isSubmitting || !storeUrl}
                  className="bg-[#f97316] hover:bg-[#ea580c] disabled:bg-[#fdba74] text-white font-medium px-6 py-2.5 rounded-full transition-colors flex-shrink-0"
                >
                  {isSubmitting ? (
                    <svg
                      className="animate-spin h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  ) : (
                    'Analyze Store'
                  )}
                </button>
              </div>

              {error && (
                <p className="text-sm text-red-500 mt-3 text-center">{error}</p>
              )}
            </form>
          </div>
        </div>
      </WarpBackground>
    </div>
  );
}

