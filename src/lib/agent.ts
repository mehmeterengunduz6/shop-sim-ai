export interface AnalysisResult {
  run_id: string;
  store_url: string;
  status: 'completed' | 'failed';
  score: number;
  metrics: {
    add_to_cart_success: boolean;
    time_to_add_to_cart_seconds: number | null;
    checkout_reached: boolean;
    checkout_form_filled: boolean;
    drop_off_step: string | null;
  };
  findings: Finding[];
  timeline: TimelineEvent[];
  session_url: string | null;
  error?: string;
}

export interface Finding {
  id: string;
  category: 'critical' | 'warning' | 'suggestion' | 'positive';
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

    // Get the page from stagehand.context.pages()[0] as per V3 documentation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const page = (stagehand as any).context.pages()[0] as import('playwright').Page;
    
    if (!page) {
      throw new Error('Could not get page from stagehand.context.pages()');
    }
    
    console.log('Got page from stagehand.context.pages()[0]');
    
    // Step 1: Navigate to store
    console.log(`Navigating to: ${storeUrl}`);
    await page.goto(storeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // Wait for page to settle
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    let currentUrl = page.url();
    console.log(`Successfully navigated to: ${currentUrl}`);
    
    timeline.push({
      timestamp: new Date().toISOString(),
      action: 'Navigate to store',
      url: currentUrl,
      success: true,
    });

    // ============ HOMEPAGE UX ANALYSIS ============
    console.log('Analyzing homepage UX...');
    try {
      const homepageAnalysis = await stagehand.extract(`Analyze this homepage/landing page and answer these questions:
        1. Is there a clear search bar or search icon visible?
        2. Is the navigation menu clear and easy to understand?
        3. Are products or a "Shop" section easy to find?
        4. Is the page well-organized or cluttered?
        5. Are there clear call-to-action buttons?
        6. Is the branding/logo visible?
        7. Are there any popups or overlays that might be annoying?
        8. Is there a language/currency selector if relevant?
        
        Provide specific observations for each point.`);
      
      const homepageStr = JSON.stringify(homepageAnalysis).toLowerCase();
      console.log('Homepage analysis:', homepageStr);
      
      // Check for search functionality
      if (!homepageStr.includes('search') || homepageStr.includes('no search') || homepageStr.includes('not visible')) {
        if (!homepageStr.includes('search bar') && !homepageStr.includes('search icon')) {
          findings.push({
            id: 'homepage-no-search',
            category: 'warning',
            title: 'Search Not Prominently Visible',
            description: 'The search functionality is not clearly visible on the homepage',
            evidence: 'Search bar/icon not easily found during homepage analysis',
            recommendation: 'Add a prominent search bar in the header to help users find products quickly',
          });
        }
      }
      
      // Check for navigation clarity
      if (homepageStr.includes('confusing') || homepageStr.includes('cluttered') || homepageStr.includes('unclear') || homepageStr.includes('difficult')) {
        findings.push({
          id: 'homepage-navigation-unclear',
          category: 'warning',
          title: 'Navigation Could Be Clearer',
          description: 'The navigation menu or page layout may be confusing to users',
          evidence: 'Navigation described as unclear or cluttered during analysis',
          recommendation: 'Simplify the navigation menu and ensure clear visual hierarchy',
        });
      }
      
      // Check for products visibility
      if (homepageStr.includes('hard to find') || homepageStr.includes('not easy') || homepageStr.includes('difficult to locate')) {
        findings.push({
          id: 'homepage-products-hidden',
          category: 'suggestion',
          title: 'Products Not Immediately Visible',
          description: 'Users may have difficulty finding products from the homepage',
          evidence: 'Products or shop section not prominently displayed',
          recommendation: 'Feature popular products on the homepage or make the shop section more prominent',
        });
      }
      
      // Check for annoying popups
      if (homepageStr.includes('popup') || homepageStr.includes('overlay') || homepageStr.includes('modal')) {
        if (homepageStr.includes('annoying') || homepageStr.includes('intrusive') || homepageStr.includes('blocking')) {
          findings.push({
            id: 'homepage-intrusive-popups',
            category: 'warning',
            title: 'Intrusive Popups Detected',
            description: 'Popups or overlays may be disrupting the user experience',
            evidence: 'Intrusive popup/overlay detected on homepage',
            recommendation: 'Delay popups or make them less intrusive to improve first impression',
          });
        }
      }
      
      timeline.push({
        timestamp: new Date().toISOString(),
        action: 'Analyzed homepage UX',
        url: currentUrl,
        success: true,
      });
    } catch (homepageError) {
      console.log('Homepage analysis error:', homepageError);
    }

    // Step 2: Look for products and try to find one to add to cart
    timeline.push({
      timestamp: new Date().toISOString(),
      action: 'Looking for products',
      url: currentUrl,
      success: true,
    });

    try {
      // Step 2a: First, try to find a product directly on the page or navigate to products section
      const initialPageCheck = await stagehand.extract('Look at the page. Are there any products with PRICES visible that I can click on directly? Or is this a homepage where I need to navigate to a products/shop section first?');
      const initialCheckStr = JSON.stringify(initialPageCheck).toLowerCase();
      console.log('Initial page check:', initialCheckStr);
      
      // If on homepage, navigate to products section first
      if (initialCheckStr.includes('homepage') || initialCheckStr.includes('navigate') || !initialCheckStr.includes('price')) {
        console.log('On homepage, navigating to products section...');
        
        // Handle dropdown menus - hover first, then click a category
        await stagehand.act(`Navigate to the products/shop section:
          1. First, hover over or click "Ürünler", "Products", "Shop", or similar navigation menu item
          2. If a dropdown menu appears with product categories, click on the FIRST category link (like "Fındık Çeşitleri", "All Products", or any product category)
          3. If no dropdown appears, look for a direct link to products and click it
          
          The goal is to reach a page that shows a list of purchasable products with prices.`);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        currentUrl = page.url();
        console.log('After navigation attempt, URL:', currentUrl);
        
        // Check if URL changed - if not, the dropdown might still be open
        if (currentUrl === storeUrl || currentUrl === storeUrl + '/') {
          console.log('URL unchanged, trying to click a category from dropdown...');
          await stagehand.act(`A dropdown menu should be open. Look for and click on any product category link inside the dropdown menu. 
            Examples: "Fındık Çeşitleri", "Fındıklı Drajeler", "Fındık Kreması", "Tüm Ürünler", "All Products", or any category that will show products with prices.
            Click on a link that will navigate to a category page, not just highlight it.`);
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          currentUrl = page.url();
          console.log('After clicking category, URL:', currentUrl);
        }
      }
      
      // Step 2b: Now we should be on a category page, find and click a product
      await stagehand.act(`Find and click on a specific PRODUCT (not a category):
        - Look for product cards or product images with PRICES displayed (like "100 TL", "455,00 TL")
        - Click on the product image or product name/title to go to the product detail page
        - Avoid clicking on category links, filters, or navigation items
        
        Click on ONE product to view its details.`);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      currentUrl = page.url();
      console.log('After clicking product, URL:', currentUrl);
      
      // Check if we're on a product page
      const pageCheck = await stagehand.extract('Is this a product detail page where I can add an item to cart? Look for: a single product with title, price, and "Add to Cart" or "Sepete Ekle" button. Respond with YES or NO.');
      const pageCheckStr = JSON.stringify(pageCheck).toLowerCase();
      console.log('Product page check:', pageCheckStr);
      
      if (!pageCheckStr.includes('yes')) {
        // Still not on a product page, try one more time
        console.log('Still not on product page, trying again...');
        await stagehand.act('Find and click on any product card that shows a price. Click on the product image or name to go to its detail page.');
        await new Promise(resolve => setTimeout(resolve, 2000));
        currentUrl = page.url();
      }
      
      timeline.push({
        timestamp: new Date().toISOString(),
        action: 'Navigated to product page',
        url: currentUrl,
        success: true,
      });

      // ============ PRODUCT PAGE UX ANALYSIS ============
      console.log('Analyzing product page UX...');
      try {
        const productPageAnalysis = await stagehand.extract(`Analyze this product page and answer these questions:
          1. Is the product price clearly displayed and easy to read?
          2. Are the product images clear, high-quality, and zoomable?
          3. Is the "Add to Cart" button prominent and easy to find?
          4. Is there a clear product title/name?
          5. Is there a product description available?
          6. Is stock availability shown (in stock, out of stock, limited)?
          7. Are there customer reviews or ratings visible?
          8. Are product variants (size, color) easy to select?
          9. Is there shipping information visible?
          10. Are there any trust signals (guarantees, return policy)?
          
          Provide specific observations for each point.`);
        
        const productStr = JSON.stringify(productPageAnalysis).toLowerCase();
        console.log('Product page analysis:', productStr);
        
        // Check price visibility
        if (productStr.includes('price') && (productStr.includes('not clear') || productStr.includes('hard to find') || productStr.includes('not visible'))) {
          findings.push({
            id: 'product-price-unclear',
            category: 'critical',
            title: 'Product Price Not Clear',
            description: 'The product price is not prominently displayed',
            evidence: 'Price visibility issue detected on product page',
            recommendation: 'Display the price in a larger font near the product title and add-to-cart button',
          });
        }
        
        // Check image quality
        if (productStr.includes('image') && (productStr.includes('blurry') || productStr.includes('low quality') || productStr.includes('small') || productStr.includes('not zoomable'))) {
          findings.push({
            id: 'product-images-poor',
            category: 'warning',
            title: 'Product Images Could Be Better',
            description: 'Product images may not be high quality or zoomable',
            evidence: 'Image quality or zoom functionality issues detected',
            recommendation: 'Use high-resolution product images with zoom functionality',
          });
        }
        
        // Check add to cart button
        if (productStr.includes('add to cart') && (productStr.includes('not prominent') || productStr.includes('hard to find') || productStr.includes('small'))) {
          findings.push({
            id: 'product-atc-not-prominent',
            category: 'warning',
            title: 'Add to Cart Button Not Prominent',
            description: 'The add to cart button may not stand out enough',
            evidence: 'Add to cart button prominence issue detected',
            recommendation: 'Make the add to cart button larger with a contrasting color',
          });
        }
        
        // Check for reviews/ratings
        if (!productStr.includes('review') && !productStr.includes('rating') && !productStr.includes('star')) {
          findings.push({
            id: 'product-no-reviews',
            category: 'suggestion',
            title: 'No Reviews/Ratings Visible',
            description: 'Product reviews or ratings are not displayed',
            evidence: 'No customer reviews or ratings found on product page',
            recommendation: 'Display customer reviews and ratings to build trust and help purchase decisions',
          });
        } else if (productStr.includes('no review') || productStr.includes('no rating')) {
          findings.push({
            id: 'product-no-reviews',
            category: 'suggestion',
            title: 'No Reviews/Ratings Visible',
            description: 'Product reviews or ratings are not displayed',
            evidence: 'No customer reviews or ratings found on product page',
            recommendation: 'Display customer reviews and ratings to build trust and help purchase decisions',
          });
        }
        
        // Check stock availability
        if (!productStr.includes('stock') && !productStr.includes('availability') && !productStr.includes('stok')) {
          findings.push({
            id: 'product-no-stock-info',
            category: 'suggestion',
            title: 'Stock Availability Not Shown',
            description: 'Product stock/availability information is not visible',
            evidence: 'No stock availability indicator found on product page',
            recommendation: 'Show stock availability to create urgency and prevent cart abandonment',
          });
        }
        
        // Check shipping info on product page
        if (!productStr.includes('shipping') && !productStr.includes('delivery') && !productStr.includes('kargo') && !productStr.includes('teslimat')) {
          findings.push({
            id: 'product-no-shipping-info',
            category: 'suggestion',
            title: 'No Shipping Info on Product Page',
            description: 'Shipping/delivery information is not visible on the product page',
            evidence: 'No shipping information found before add to cart',
            recommendation: 'Display estimated delivery time and shipping cost on the product page',
          });
        }
        
        timeline.push({
          timestamp: new Date().toISOString(),
          action: 'Analyzed product page UX',
          url: currentUrl,
          success: true,
        });
      } catch (productAnalysisError) {
        console.log('Product page analysis error:', productAnalysisError);
      }

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
        url: currentUrl,
        success: true,
      });

      try {
        // First attempt: Try to select variants and add to cart
        console.log('Attempting to add product to cart...');
        await stagehand.act(`On this product page, do the following in order:
          1. If there are size, color, or variant options (dropdown or buttons), select the first available option
          2. If there is a quantity field, leave it at 1 or the default
          3. Find and click the "Add to Cart", "Sepete Ekle", "Add to Bag", or "Buy Now" button
          
          Make sure to click the actual add to cart button, not a wishlist or compare button.`);

        // Wait for cart update or error message
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if there's an error message requiring size/variant selection
        const errorCheck = await stagehand.extract(`Is there any error message or warning visible on the page? 
          Look for messages like:
          - "Beden seçmelisin" (You need to select a size)
          - "Lütfen beden seçiniz" (Please select a size)
          - "Please select a size"
          - "Please select a variant"
          - "Select size before adding"
          - Any red/orange warning text near the add to cart button
          
          Describe any error or warning messages you see.`);
        
        const errorCheckStr = JSON.stringify(errorCheck).toLowerCase();
        console.log('Error check after first add to cart attempt:', errorCheckStr);
        
        // Check if we need to select size/variant
        const needsVariantSelection = 
          errorCheckStr.includes('beden') ||
          errorCheckStr.includes('size') ||
          errorCheckStr.includes('seç') ||
          errorCheckStr.includes('select') ||
          errorCheckStr.includes('variant') ||
          errorCheckStr.includes('renk') ||
          errorCheckStr.includes('color') ||
          errorCheckStr.includes('required') ||
          errorCheckStr.includes('zorunlu') ||
          errorCheckStr.includes('lütfen');
        
        if (needsVariantSelection) {
          console.log('Size/variant selection required, retrying...');
          
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Detected size/variant selection required',
            url: page.url(),
            success: true,
          });
          
          // Explicitly select size/variant options
          await stagehand.act(`There is an error saying you need to select a size or variant. 
            Look for size buttons (like S, M, L, XL, 36, 38, 40, etc.) or a size dropdown.
            Click on the FIRST available size option that is not grayed out or crossed out.
            If there are color options, select the first available color as well.
            After selecting, wait a moment for the page to update.`);
          
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Try adding to cart again
          console.log('Retrying add to cart after selecting size...');
          await stagehand.act(`Now click the "Add to Cart", "Sepete Ekle", "Add to Bag", or "Buy Now" button again.
            The size should now be selected. Click the main add to cart button.`);
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Check for errors again
          const secondErrorCheck = await stagehand.extract('Is there still an error message about size or variant selection? Or was the item added to cart successfully?');
          const secondErrorStr = JSON.stringify(secondErrorCheck).toLowerCase();
          
          if (secondErrorStr.includes('beden') || secondErrorStr.includes('size') || secondErrorStr.includes('error')) {
            // Still having issues, try one more time with a different approach
            console.log('Still having size issues, trying dropdown approach...');
            
            await stagehand.act(`The size selection might be a dropdown menu. 
              Look for any dropdown/select element near the product options.
              Click on it and select the first available size option from the dropdown.
              If sizes are shown as clickable buttons, make sure to click directly on a size button (not just hover).
              Then click the Add to Cart button again.`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
        
        // Wait for cart update
        await new Promise(resolve => setTimeout(resolve, 1500));
        currentUrl = page.url();
        
        // Verify the product was actually added to cart
        const cartCheck = await stagehand.extract('Check the shopping cart icon or cart indicator. How many items are in the cart? Look for a number badge on the cart icon. Also check if there is a success message like "Added to cart" or "Sepete eklendi". If you see "0" or no items and no success message, the add to cart may have failed.');
        const cartCheckStr = JSON.stringify(cartCheck).toLowerCase();
        
        console.log('Cart check result:', cartCheckStr);
        
        // Check if cart has items or success message
        const hasItems = !cartCheckStr.includes('"0"') && 
                        !cartCheckStr.includes('0 item') && 
                        !cartCheckStr.includes('empty') &&
                        !cartCheckStr.includes('no item') &&
                        (cartCheckStr.includes('1') || cartCheckStr.includes('item') || cartCheckStr.includes('added') || cartCheckStr.includes('eklendi') || cartCheckStr.includes('success'));
        
        if (hasItems) {
          addToCartTime = Date.now();
          timeToAddToCart = Math.round((addToCartTime - startTime) / 1000);
          addToCartSuccess = true;

          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Added product to cart',
            url: currentUrl,
            success: true,
          });

          // ============ CART/ADD-TO-CART UX ANALYSIS ============
          console.log('Analyzing cart experience...');
          try {
            const cartExperienceAnalysis = await stagehand.extract(`Analyze the add-to-cart experience and current cart state:
              1. Was there clear feedback when the item was added (popup, animation, notification)?
              2. Is there a "Free shipping" threshold message (like "Add X more for free shipping")?
              3. Can you easily see what's in the cart (cart summary visible)?
              4. Is there a clear way to continue shopping?
              5. Is there a clear path/button to proceed to checkout?
              6. Are there any upsell or cross-sell suggestions shown after adding to cart?
              7. Is the cart total clearly displayed?
              8. Is there a mini-cart or cart sidebar visible?
              
              Describe what you see after adding the item to cart.`);
            
            const cartExpStr = JSON.stringify(cartExperienceAnalysis).toLowerCase();
            console.log('Cart experience analysis:', cartExpStr);
            
            // Check for add-to-cart feedback
            if (!cartExpStr.includes('feedback') && !cartExpStr.includes('notification') && !cartExpStr.includes('popup') && !cartExpStr.includes('animation') && !cartExpStr.includes('confirmation')) {
              findings.push({
                id: 'cart-no-feedback',
                category: 'warning',
                title: 'No Clear Add-to-Cart Feedback',
                description: 'Users may not realize the item was added to cart',
                evidence: 'No clear visual feedback detected after adding to cart',
                recommendation: 'Add a clear confirmation popup, animation, or notification when items are added to cart',
              });
            }
            
            // Check for free shipping threshold
            if (!cartExpStr.includes('free shipping') && !cartExpStr.includes('ücretsiz kargo') && !cartExpStr.includes('shipping threshold')) {
              findings.push({
                id: 'cart-no-shipping-threshold',
                category: 'suggestion',
                title: 'No Free Shipping Threshold Message',
                description: 'Missing opportunity to encourage larger orders with free shipping incentive',
                evidence: 'No "Add X more for free shipping" message detected',
                recommendation: 'Display how much more the customer needs to spend for free shipping',
              });
            }
            
            // Check for upsell after add to cart
            if (!cartExpStr.includes('upsell') && !cartExpStr.includes('cross-sell') && !cartExpStr.includes('also like') && !cartExpStr.includes('recommend') && !cartExpStr.includes('related')) {
              findings.push({
                id: 'cart-no-upsell',
                category: 'suggestion',
                title: 'No Upsell After Add to Cart',
                description: 'Missing opportunity to increase order value with product suggestions',
                evidence: 'No product recommendations shown after adding to cart',
                recommendation: 'Show "Frequently bought together" or related products after add to cart',
              });
            }
            
            // Check for clear checkout path
            if (cartExpStr.includes('checkout') && (cartExpStr.includes('not clear') || cartExpStr.includes('hard to find') || cartExpStr.includes('hidden'))) {
              findings.push({
                id: 'cart-checkout-unclear',
                category: 'warning',
                title: 'Checkout Button Not Prominent',
                description: 'Users may have difficulty finding how to proceed to checkout',
                evidence: 'Checkout button or path not prominently displayed',
                recommendation: 'Make the checkout button more visible with contrasting colors',
              });
            }
            
            timeline.push({
              timestamp: new Date().toISOString(),
              action: 'Analyzed cart experience',
              url: currentUrl,
              success: true,
            });
          } catch (cartAnalysisError) {
            console.log('Cart experience analysis error:', cartAnalysisError);
          }

        } else {
          // Cart is still empty, check why
          console.log('Cart still empty, checking for errors...');
          
          const finalErrorCheck = await stagehand.extract(`Why couldn't the item be added to cart? Look for:
            - Error messages about size/variant selection
            - Out of stock messages
            - Login required messages
            - Any other error or warning text
            Describe what you see.`);
          
          const finalErrorStr = JSON.stringify(finalErrorCheck).toLowerCase();
          console.log('Final error check:', finalErrorStr);
          
          // Determine the specific issue
          if (finalErrorStr.includes('beden') || finalErrorStr.includes('size') || finalErrorStr.includes('variant')) {
            findings.push({
              id: 'add-to-cart-size-required',
              category: 'warning',
              title: 'Size Selection UX Issue',
              description: 'Product requires size selection but the options may not be obvious or easy to select',
              evidence: `Error: ${finalErrorStr.substring(0, 200)}`,
              recommendation: 'Make size/variant options more prominent and clearly indicate when selection is required before adding to cart',
            });
          } else if (finalErrorStr.includes('stock') || finalErrorStr.includes('stok') || finalErrorStr.includes('tükendi')) {
            findings.push({
              id: 'add-to-cart-out-of-stock',
              category: 'warning',
              title: 'Product Out of Stock',
              description: 'The selected product appears to be out of stock',
              evidence: `Error: ${finalErrorStr.substring(0, 200)}`,
              recommendation: 'Show stock availability clearly and suggest similar in-stock products',
            });
          } else if (finalErrorStr.includes('login') || finalErrorStr.includes('giriş') || finalErrorStr.includes('üye')) {
            findings.push({
              id: 'add-to-cart-login-required',
              category: 'critical',
              title: 'Login Required to Add to Cart',
              description: 'Users must be logged in to add items to cart',
              evidence: `Error: ${finalErrorStr.substring(0, 200)}`,
              recommendation: 'Allow guest users to add items to cart without logging in',
            });
          } else {
            findings.push({
              id: 'add-to-cart-failed',
              category: 'critical',
              title: 'Add to Cart Failed',
              description: 'Clicked add to cart but the cart remained empty',
              evidence: `Cart check: ${cartCheckStr}, Error check: ${finalErrorStr.substring(0, 200)}`,
              recommendation: 'Verify the add to cart button is functional and provides clear feedback',
            });
          }
          dropOffStep = 'add_to_cart';
        }
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

    // Step 4: Go to cart and proceed to checkout
    if (addToCartSuccess && !dropOffStep) {
      timeline.push({
        timestamp: new Date().toISOString(),
        action: 'Navigating to cart/checkout',
        url: currentUrl,
        success: true,
      });

      try {
        // First, go to the cart or click checkout button
        await stagehand.act('Look for and click the cart icon, "Sepet" (Cart), "Ödeme" (Payment/Checkout), "Checkout", "View Cart", "Go to Cart", or any button/link that takes you to view the cart or start checkout. If a cart sidebar/modal is already visible, click the checkout or payment button inside it.');

        await new Promise(resolve => setTimeout(resolve, 2000));
        currentUrl = page.url();
        
        timeline.push({
          timestamp: new Date().toISOString(),
          action: 'Clicked cart/checkout button',
          url: currentUrl,
          success: true,
        });

        // Step 5: If on cart page, proceed to checkout
        const cartPageInfo = await stagehand.extract('What page are we on? Is there a checkout button, payment button, or "Ödeme" button visible? Describe what actions are available.');
        const cartInfoStr = JSON.stringify(cartPageInfo).toLowerCase();
        
        if (cartInfoStr.includes('cart') || cartInfoStr.includes('sepet')) {
          // We're on cart page, click proceed to checkout
          await stagehand.act('Click the "Checkout", "Proceed to Checkout", "Ödeme", "Ödemeye Geç", "Satın Al", or any button that proceeds to the checkout/payment page.');
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          currentUrl = page.url();
          
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Proceeded to checkout from cart',
            url: currentUrl,
            success: true,
          });
        }

        checkoutReached = true;

        // Step 6: Fill in checkout form with dummy data (but DO NOT submit payment)
        timeline.push({
          timestamp: new Date().toISOString(),
          action: 'Filling checkout form',
          url: currentUrl,
          success: true,
        });

        try {
          // ============ CHECKOUT FORM FILLING - STEP BY STEP ============
          console.log('Starting checkout form filling...');
          
          // Step 6a: Check if we need to handle login/guest checkout first
          const loginCheck = await stagehand.extract('Is there a login form or guest checkout option visible? Is there a "Continue as guest" or "Misafir olarak devam et" button?');
          const loginCheckStr = JSON.stringify(loginCheck).toLowerCase();
          
          if (loginCheckStr.includes('login') || loginCheckStr.includes('guest')) {
            console.log('Handling guest checkout option...');
            await stagehand.act('If there is a guest checkout option ("Continue as guest", "Misafir olarak devam et", "Üye olmadan devam"), click it. If there is an email field for guest checkout, enter test@example.com');
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
          
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Handling login/guest checkout',
            url: page.url(),
            success: true,
          });

          // Step 6b: Fill contact information (email, phone)
          console.log('Filling contact information...');
          await stagehand.act(`Fill in contact information fields if visible:
            - Email: test@example.com
            - Phone: 5551234567
            Look for fields labeled Email, E-posta, Phone, Telefon, Mobile, Cep Telefonu.`);
          
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Filled contact information',
            url: page.url(),
            success: true,
          });

          // Step 6c: Fill name fields
          console.log('Filling name fields...');
          await stagehand.act(`Fill in name fields if visible:
            - First Name / Ad: Test
            - Last Name / Soyad: Müşteri
            - Full Name / Ad Soyad: Test Müşteri
            Look for fields labeled Name, First Name, Last Name, Ad, Soyad, Ad Soyad.`);
          
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Filled name fields',
            url: page.url(),
            success: true,
          });

          // Step 6d: Fill address fields
          console.log('Filling address fields...');
          await stagehand.act(`Fill in address fields if visible:
            - Address / Adres: Test Sokak No:1 Daire:2
            - City / İl / Şehir: İstanbul
            - District / İlçe: Kadıköy
            - Neighborhood / Mahalle: Test Mahallesi
            - Postal Code / ZIP / Posta Kodu: 34710
            - Country / Ülke: Select Turkey or Türkiye if there's a dropdown
            
            If there's an "Add new address" or "Yeni adres ekle" button and no form is visible, click it first.`);
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Filled address fields',
            url: page.url(),
            success: true,
          });

          // Step 6e: Handle address modal if one appeared
          const modalCheck = await stagehand.extract('Is there a modal or popup open for address entry? Is there a Save or Kaydet button visible in a modal?');
          const modalCheckStr = JSON.stringify(modalCheck).toLowerCase();
          
          if (modalCheckStr.includes('modal') || modalCheckStr.includes('popup') || modalCheckStr.includes('kaydet') || modalCheckStr.includes('save')) {
            console.log('Handling address modal...');
            await stagehand.act('Click the Save, Kaydet, Confirm, Onayla, or similar button to save the address in the modal/popup.');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            timeline.push({
              timestamp: new Date().toISOString(),
              action: 'Saved address from modal',
              url: page.url(),
              success: true,
            });
          }

          // Step 6f: Select shipping method
          console.log('Selecting shipping method...');
          await stagehand.act(`If there are shipping method options visible (radio buttons or checkboxes for different shipping speeds/prices):
            - Select the first available shipping option
            - Or select standard/free shipping if available
            Look for "Kargo", "Teslimat", "Shipping", "Delivery" options.`);
          
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Selected shipping method',
            url: page.url(),
            success: true,
          });

          // Step 6g: Proceed to payment step (but don't enter payment info)
          console.log('Proceeding to payment step...');
          await stagehand.act(`Look for a "Continue to payment", "Proceed", "Next", "Ödemeye Geç", "Devam Et", "Sonraki Adım" button and click it.
            This should take you to the payment step where you can see payment options.
            DO NOT click any final "Pay Now", "Place Order", "Ödeme Yap", "Siparişi Tamamla" buttons.`);
          
          await new Promise(resolve => setTimeout(resolve, 2000));
          currentUrl = page.url();

          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Filled checkout form with dummy data',
            url: currentUrl,
            success: true,
          });

          // Step 7: Analyze the checkout page for UX issues
          const checkoutAnalysis = await stagehand.extract(`Analyze this checkout page and provide insights:
            1. Is there a discount/coupon code field visible?
            2. Are there any upsell or cross-sell suggestions?
            3. Is the payment button clearly visible and labeled?
            4. Are there trust badges or security indicators?
            5. Are shipping costs clearly displayed?
            6. Is there a guest checkout option or is login required?
            7. How many form fields are required?
            8. Are there any error messages visible?
            9. Is there a progress indicator showing checkout steps?
            10. Are there any recommendations for increasing average order value (like "Add X more for free shipping")?`);

          const analysisStr = JSON.stringify(checkoutAnalysis);
          console.log('Checkout analysis:', analysisStr);

          // Generate findings based on checkout analysis
          if (!analysisStr.toLowerCase().includes('discount') && !analysisStr.toLowerCase().includes('coupon')) {
            findings.push({
              id: 'no-discount-field',
              category: 'suggestion',
              title: 'No Discount Code Field Visible',
              description: 'The checkout page does not prominently display a discount code field',
              evidence: 'Discount/coupon field not found during checkout analysis',
              recommendation: 'Add a visible discount code field to encourage conversions and allow marketing campaigns',
            });
          }

          if (!analysisStr.toLowerCase().includes('upsell') && !analysisStr.toLowerCase().includes('cross-sell') && !analysisStr.toLowerCase().includes('related') && !analysisStr.toLowerCase().includes('recommend')) {
            findings.push({
              id: 'no-upsell',
              category: 'suggestion',
              title: 'No Upsell/Cross-sell at Checkout',
              description: 'The checkout page does not show product recommendations',
              evidence: 'No upsell or cross-sell suggestions found at checkout',
              recommendation: 'Add "Frequently bought together" or "You might also like" sections to increase average order value',
            });
          }

          if (!analysisStr.toLowerCase().includes('trust') && !analysisStr.toLowerCase().includes('security') && !analysisStr.toLowerCase().includes('ssl') && !analysisStr.toLowerCase().includes('secure')) {
            findings.push({
              id: 'no-trust-badges',
              category: 'warning',
              title: 'No Trust Badges Visible',
              description: 'Security and trust indicators are not prominently displayed',
              evidence: 'No trust badges or security indicators found on checkout page',
              recommendation: 'Add SSL badges, payment provider logos, and security seals to increase buyer confidence',
            });
          }

          if (!analysisStr.toLowerCase().includes('free shipping') && !analysisStr.toLowerCase().includes('ücretsiz kargo')) {
            findings.push({
              id: 'no-free-shipping-threshold',
              category: 'suggestion',
              title: 'No Free Shipping Incentive',
              description: 'No "Add X more for free shipping" message found',
              evidence: 'Free shipping threshold messaging not detected',
              recommendation: 'Display "Add X TL more for free shipping" to encourage larger orders',
            });
          }

          // Check for guest checkout availability
          const analysisLower = analysisStr.toLowerCase();
          if (analysisLower.includes('login required') || 
              (analysisLower.includes('login') && !analysisLower.includes('guest')) ||
              analysisLower.includes('account required') ||
              analysisLower.includes('sign in required')) {
            findings.push({
              id: 'checkout-no-guest',
              category: 'warning',
              title: 'Guest Checkout Not Available',
              description: 'Users are required to create an account or log in to checkout',
              evidence: 'Login/account required before checkout completion',
              recommendation: 'Offer guest checkout option to reduce friction and cart abandonment',
            });
          }

          // Check for too many form fields
          const fieldMatch = analysisStr.match(/(\d+)\s*(form\s*)?fields?/i);
          if (fieldMatch) {
            const fieldCount = parseInt(fieldMatch[1]);
            if (fieldCount > 8) {
              findings.push({
                id: 'checkout-too-many-fields',
                category: 'suggestion',
                title: 'Too Many Form Fields',
                description: `Checkout form has ${fieldCount} fields which may cause abandonment`,
                evidence: `${fieldCount} form fields detected during checkout analysis`,
                recommendation: 'Reduce form fields to essential information only (aim for 6-8 fields max)',
              });
            }
          }

          // Check for progress indicator
          if (!analysisLower.includes('progress') && 
              !analysisLower.includes('step') && 
              !analysisLower.includes('indicator') &&
              !analysisLower.includes('adım')) {
            findings.push({
              id: 'checkout-no-progress',
              category: 'suggestion',
              title: 'No Progress Indicator',
              description: 'Checkout does not show progress through the checkout steps',
              evidence: 'No progress indicator or step tracker found',
              recommendation: 'Add a progress bar or step indicator (e.g., "Step 2 of 3") to reduce anxiety',
            });
          }

          // Check for shipping costs display
          if (!analysisLower.includes('shipping cost') && 
              !analysisLower.includes('delivery cost') && 
              !analysisLower.includes('kargo ücreti') &&
              (analysisLower.includes('shipping') || analysisLower.includes('kargo'))) {
            if (analysisLower.includes('not displayed') || 
                analysisLower.includes('not visible') || 
                analysisLower.includes('hidden') ||
                analysisLower.includes('unclear')) {
              findings.push({
                id: 'checkout-unclear-shipping',
                category: 'warning',
                title: 'Shipping Costs Not Clear',
                description: 'Shipping costs are not clearly displayed before checkout completion',
                evidence: 'Shipping cost visibility issue detected',
                recommendation: 'Display shipping costs clearly and early to prevent surprise costs at checkout',
              });
            }
          }

          // Check for error messages
          if (analysisLower.includes('error') && !analysisLower.includes('no error')) {
            if (analysisLower.includes('error message') || analysisLower.includes('validation error')) {
              findings.push({
                id: 'checkout-has-errors',
                category: 'critical',
                title: 'Form Validation Errors Present',
                description: 'Error messages are visible on the checkout form',
                evidence: 'Validation errors detected during checkout process',
                recommendation: 'Review form validation and ensure error messages are helpful and actionable',
              });
            }
          }

          timeline.push({
            timestamp: new Date().toISOString(),
            action: 'Analyzed checkout page for UX issues',
            url: currentUrl,
            success: true,
          });

        } catch (formError) {
          console.log('Could not complete checkout form:', formError);
          findings.push({
            id: 'checkout-form-issues',
            category: 'warning',
            title: 'Checkout Form Difficulties',
            description: 'The AI agent had difficulty filling out the checkout form',
            evidence: `Error: ${formError instanceof Error ? formError.message : 'Unknown error'}`,
            recommendation: 'Simplify checkout form, reduce required fields, and ensure clear labels',
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

    // Calculate score based on funnel completion and UX quality
    let score = 0;
    
    // Funnel completion scoring (max 60 points)
    if (addToCartSuccess) score += 20;  // Successfully added to cart
    if (checkoutReached) score += 20;   // Reached checkout page
    
    // Check if checkout form was filled (means checkout flow works)
    const checkoutFormFilled = timeline.some(t => t.action.includes('Filled checkout form'));
    if (checkoutFormFilled) score += 20; // Successfully filled checkout form
    
    // UX Quality scoring (max 40 points)
    // Start with 40 and subtract for missing best practices
    let uxScore = 40;
    
    // Critical issues are major problems (-15 each)
    uxScore -= findings.filter(f => f.category === 'critical').length * 15;
    
    // Warnings are moderate issues (-8 each)
    uxScore -= findings.filter(f => f.category === 'warning').length * 8;
    
    // Suggestions are missed opportunities for optimization (-5 each)
    uxScore -= findings.filter(f => f.category === 'suggestion').length * 5;
    
    // Add UX score (minimum 0)
    score += Math.max(0, uxScore);
    
    // Ensure score is between 0-100
    score = Math.max(0, Math.min(100, score));

    // Add positive findings if things went well
    if (addToCartSuccess) {
      findings.push({
        id: 'successful-add-to-cart',
        category: 'positive',
        title: 'Add to Cart Works',
        description: 'Products can be successfully added to the shopping cart',
        evidence: 'Successfully added a product to cart during analysis',
        recommendation: 'Continue maintaining this core functionality',
      });
      
      if (timeToAddToCart && timeToAddToCart < 30) {
        findings.push({
          id: 'fast-add-to-cart',
          category: 'positive',
          title: 'Fast Add-to-Cart Experience',
          description: `Product was added to cart in ${timeToAddToCart} seconds`,
          evidence: `Time from page load to cart: ${timeToAddToCart}s`,
          recommendation: 'Keep maintaining this smooth experience',
        });
      }
    }
    
    if (checkoutReached) {
      findings.push({
        id: 'successful-checkout-reach',
        category: 'positive',
        title: 'Checkout Flow Accessible',
        description: 'Users can navigate from product to checkout successfully',
        evidence: 'Checkout page reached during analysis',
        recommendation: 'The checkout funnel is working - focus on optimization',
      });
    }
    
    if (checkoutFormFilled) {
      findings.push({
        id: 'successful-form-fill',
        category: 'positive',
        title: 'Checkout Form Functional',
        description: 'The checkout form accepts customer information correctly',
        evidence: 'Form fields were successfully filled during analysis',
        recommendation: 'Form is usable - consider optimizing for speed',
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
        checkout_form_filled: checkoutFormFilled,
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
        checkout_form_filled: false,
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
