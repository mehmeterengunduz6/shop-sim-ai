export interface AnalysisResult {
  run_id: string;
  store_url: string;
  status: 'completed' | 'failed';
  score: number;
  metrics: {
    add_to_cart_success: boolean;
    time_to_add_to_cart_seconds: number | null;
    checkout_reached: boolean;
    drop_off_step: string | null;
  };
  findings: Finding[];
  timeline: TimelineEvent[];
  session_url: string | null;
  error?: string;
}

export interface Finding {
  id: string;
  category: 'critical' | 'warning' | 'suggestion';
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
}

export interface TimelineEvent {
  timestamp: string;
  action: string;
  url: string;
  success: boolean;
  screenshot?: string;
}

export async function runAnalysis(storeUrl: string, runId: string): Promise<AnalysisResult> {
  const timeline: TimelineEvent[] = [];
  const findings: Finding[] = [];
  let addToCartSuccess = false;
  let checkoutReached = false;
  let dropOffStep: string | null = null;
  let timeToAddToCart: number | null = null;
  let sessionUrl: string | null = null;
  
  const startTime = Date.now();
  let addToCartTime: number | null = null;

  // Dynamically import Stagehand to avoid Zod registry conflicts
  const { Stagehand } = await import('@browserbasehq/stagehand');

  const stagehand = new Stagehand({
    env: 'BROWSERBASE',
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    model: 'anthropic/claude-haiku-4-5',
  });

  try {
    await stagehand.init();
    
    // Get session URL for recording
    const sessionId = stagehand.browserbaseSessionID;
    if (sessionId) {
      sessionUrl = `https://browserbase.com/sessions/${sessionId}`;
    }

    // Step 1: Navigate to store
    timeline.push({
      timestamp: new Date().toISOString(),
      action: 'Navigate to store',
      url: storeUrl,
      success: true,
    });

    // Use act to navigate to the URL
    await stagehand.act(`Navigate to ${storeUrl}`);

    // Step 2: Look for products and try to find one to add to cart
    timeline.push({
      timestamp: new Date().toISOString(),
      action: 'Looking for products',
      url: storeUrl,
      success: true,
    });

    try {
      // Use Stagehand's AI to find and click on a product
      await stagehand.act('Find and click on any product that can be purchased. Look for product cards, product images, or product links.');
      
      timeline.push({
        timestamp: new Date().toISOString(),
        action: 'Clicked on a product',
        url: storeUrl,
        success: true,
      });
    } catch (e) {
      findings.push({
        id: 'no-products',
        category: 'critical',
        title: 'Could not find products',
        description: 'Unable to locate any clickable products on the page',
        evidence: `Error: ${e instanceof Error ? e.message : 'Unknown error'}`,
        recommendation: 'Ensure products are clearly visible and clickable on the homepage or add a shop/products link',
      });
      dropOffStep = 'product_discovery';
    }

    // Step 3: Try to add to cart
    if (!dropOffStep) {
      timeline.push({
        timestamp: new Date().toISOString(),
        action: 'Looking for Add to Cart button',
        url: storeUrl,
        success: true,
      });

      try {
        await stagehand.act('Click the "Add to Cart" button, "Add to Bag" button, or any button that adds this product to the shopping cart. If there are size or variant options, select the first available option first.');

        addToCartTime = Date.now();
        timeToAddToCart = Math.round((addToCartTime - startTime) / 1000);
        addToCartSuccess = true;

        timeline.push({
          timestamp: new Date().toISOString(),
          action: 'Added product to cart',
          url: storeUrl,
          success: true,
        });
      } catch (e) {
        findings.push({
          id: 'add-to-cart-failed',
          category: 'critical',
          title: 'Add to Cart Failed',
          description: 'Could not add the product to cart',
          evidence: `Error: ${e instanceof Error ? e.message : 'Unknown error'}`,
          recommendation: 'Ensure the Add to Cart button is clearly visible and functional',
        });
        dropOffStep = 'add_to_cart';
      }
    }

    // Step 4: Try to go to checkout
    if (addToCartSuccess && !dropOffStep) {
      timeline.push({
        timestamp: new Date().toISOString(),
        action: 'Navigating to checkout',
        url: storeUrl,
        success: true,
      });

      try {
        await stagehand.act('Go to the shopping cart or checkout. Click on "View Cart", "Checkout", "Go to Cart", cart icon, or any link that takes you to the checkout process.');

        // Try to extract current page info to check if we're at checkout
        const pageInfo = await stagehand.extract('What page are we on? Is this a cart page, checkout page, or product page?');
        
        const pageInfoStr = JSON.stringify(pageInfo).toLowerCase();
        const isCheckout = 
          pageInfoStr.includes('checkout') || 
          pageInfoStr.includes('cart') ||
          pageInfoStr.includes('shipping') ||
          pageInfoStr.includes('payment');

        if (isCheckout) {
          checkoutReached = true;
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Reached checkout/cart page',
            url: storeUrl,
            success: true,
          });
        } else {
          dropOffStep = 'checkout_navigation';
          findings.push({
            id: 'checkout-nav-unclear',
            category: 'warning',
            title: 'Checkout Navigation Unclear',
            description: 'Difficult to navigate from product to checkout',
            evidence: `Page info: ${pageInfoStr}`,
            recommendation: 'Add clear "Proceed to Checkout" or cart buttons after adding items',
          });
        }
      } catch (e) {
        dropOffStep = 'checkout_navigation';
        findings.push({
          id: 'checkout-failed',
          category: 'critical',
          title: 'Could not reach checkout',
          description: 'Failed to navigate to checkout after adding to cart',
          evidence: `Error: ${e instanceof Error ? e.message : 'Unknown error'}`,
          recommendation: 'Ensure checkout flow is accessible and intuitive',
        });
      }
    }

    // Calculate score
    let score = 50; // Base score
    if (addToCartSuccess) score += 25;
    if (checkoutReached) score += 25;
    score -= findings.filter(f => f.category === 'critical').length * 15;
    score -= findings.filter(f => f.category === 'warning').length * 5;
    score = Math.max(0, Math.min(100, score));

    // Add positive findings if things went well
    if (addToCartSuccess && timeToAddToCart && timeToAddToCart < 30) {
      findings.push({
        id: 'fast-add-to-cart',
        category: 'suggestion',
        title: 'Good Add-to-Cart Speed',
        description: `Product was added to cart in ${timeToAddToCart} seconds`,
        evidence: `Time: ${timeToAddToCart}s`,
        recommendation: 'Keep maintaining this smooth experience',
      });
    }

    await stagehand.close();

    return {
      run_id: runId,
      store_url: storeUrl,
      status: 'completed',
      score,
      metrics: {
        add_to_cart_success: addToCartSuccess,
        time_to_add_to_cart_seconds: timeToAddToCart,
        checkout_reached: checkoutReached,
        drop_off_step: dropOffStep,
      },
      findings,
      timeline,
      session_url: sessionUrl,
    };
  } catch (error) {
    console.error('Analysis error:', error);
    
    try {
      await stagehand.close();
    } catch {
      // Ignore close errors
    }

    return {
      run_id: runId,
      store_url: storeUrl,
      status: 'failed',
      score: 0,
      metrics: {
        add_to_cart_success: false,
        time_to_add_to_cart_seconds: null,
        checkout_reached: false,
        drop_off_step: 'initialization',
      },
      findings: [{
        id: 'analysis-failed',
        category: 'critical',
        title: 'Analysis Failed',
        description: 'The analysis could not be completed',
        evidence: error instanceof Error ? error.message : 'Unknown error',
        recommendation: 'Check if the store URL is accessible',
      }],
      timeline,
      session_url: sessionUrl,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
