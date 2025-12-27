import { NextRequest, NextResponse } from 'next/server';
import { resultsStore } from '../start/route';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: runId } = await params;

  const stored = resultsStore.get(runId);

  if (!stored) {
    return NextResponse.json(
      { error: 'Run not found' },
      { status: 404 }
    );
  }

  if (stored.status === 'running') {
    return NextResponse.json({
      run_id: runId,
      status: 'running',
    });
  }

  // Return full result
  return NextResponse.json({
    run_id: runId,
    status: stored.status,
    ...stored.result,
  });
}

