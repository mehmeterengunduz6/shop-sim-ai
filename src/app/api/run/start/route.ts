import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { runAnalysis, AnalysisResult } from '@/lib/agent';

// In-memory storage for results (replace with Supabase later for persistence)
const resultsStore = new Map<string, { status: string; result?: AnalysisResult }>();

// Export the store so other routes can access it
export { resultsStore };

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { store_url } = body;

    if (!store_url) {
      return NextResponse.json(
        { error: 'Store URL is required' },
        { status: 400 }
      );
    }

    // Validate URL
    try {
      new URL(store_url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    // Generate a unique run ID
    const runId = randomUUID();

    // Store initial status
    resultsStore.set(runId, { status: 'running' });

    console.log(`Starting analysis for: ${store_url}, run_id: ${runId}`);

    // Run analysis in background (don't await)
    runAnalysis(store_url, runId)
      .then((result) => {
        resultsStore.set(runId, { status: 'completed', result });
        console.log(`Analysis completed for run_id: ${runId}`);
      })
      .catch((error) => {
        console.error(`Analysis failed for run_id: ${runId}`, error);
        resultsStore.set(runId, {
          status: 'failed',
          result: {
            run_id: runId,
            store_url,
            status: 'failed',
            score: 0,
            metrics: {
              add_to_cart_success: false,
              time_to_add_to_cart_seconds: null,
              checkout_reached: false,
              checkout_form_filled: false,
              drop_off_step: 'initialization',
            },
            findings: [{
              id: 'error',
              category: 'critical',
              title: 'Analysis Error',
              description: error.message || 'Unknown error occurred',
              evidence: String(error),
              recommendation: 'Try again or contact support',
            }],
            timeline: [],
            session_url: null,
            error: error.message,
          }
        });
      });

    return NextResponse.json({
      run_id: runId,
      store_url,
      status: 'running',
    });
  } catch (error) {
    console.error('Error starting run:', error);
    return NextResponse.json(
      { error: 'Failed to start analysis' },
      { status: 500 }
    );
  }
}
