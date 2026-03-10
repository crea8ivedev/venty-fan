class CartRemoveButton extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('click', (event) => {
      event.preventDefault();
      const cartItems = this.closest('cart-items') || this.closest('cart-drawer-items');
      cartItems.updateQuantity(this.dataset.index, 0);
    });
  }
}

customElements.define('cart-remove-button', CartRemoveButton);

class CartItems extends HTMLElement {
  constructor() {
    super();
    this.lineItemStatusElement =
      document.getElementById('shopping-cart-line-item-status') || document.getElementById('CartDrawer-LineItemStatus');

    const debouncedOnChange = debounce((event) => {
      this.onChange(event);
    }, ON_CHANGE_DEBOUNCE_TIMER);

    this.addEventListener('change', debouncedOnChange.bind(this));

    // Intercept fetch requests to detect Kaching Bundle cart operations
    this.interceptKachingRequests();
  }



  cartUpdateUnsubscriber = undefined;
  bundleUpdateTimeout = null;

  connectedCallback() {
    this.cartUpdateUnsubscriber = subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
      if (event.source === 'cart-items') {
        return;
      }
      this.onCartUpdate();
    });

    // Detect bundle app operations to prevent upsell conflicts
    this.detectBundleOperations();

        if (this.tagName !== 'CART-DRAWER-ITEMS') {
      fetch(`${routes.cart_url}.js`)
        .then((response) => response.json())
        .then((parsedState) => {
          this.updateCartUpsellToggleState();
          this.updateCartUpsellVisibility(parsedState.item_count);
        })
        .catch((e) => {
          console.error(e);
        });
    }

  if (!window.__upsellBound) {
    document.addEventListener('change', (e) => {
      if (e.target?.id === 'cart-upsell-toggle') {
        this.onCartUpsellToggle?.call(this, e);
      }
      if (e.target?.id === 'cart-upsell-toggle-2') {
        this.onCartUpsellToggle2?.call(this, e);
      }
      if (e.target?.id === 'cart-upsell-toggle-3') {
        this.onCartUpsellToggle3?.call(this, e);
      }
    });

    window.__upsellBound = true;
  }

    
  }

  detectBundleOperations() {
    // Monitor for Kaching Bundle specific operations
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        // Check for Kaching Bundle widget processing states
        if (mutation.type === 'attributes' && 
            (mutation.target.tagName === 'KACHING-BUNDLE' ||
             mutation.target.tagName === 'KACHING-BUNDLES-BLOCK' ||
             mutation.target.classList?.contains('kaching-bundles') ||
             mutation.target.classList?.contains('kaching-bundles__block'))) {
          
          // Check for processing or loading states
          if (mutation.target.classList?.contains('processing') || 
              mutation.target.classList?.contains('loading') ||
              mutation.target.classList?.contains('adding-to-cart') ||
              mutation.target.hasAttribute('data-processing')) {
            document.body.classList.add('kaching-bundle-processing');
          } else {
            // Small delay to ensure all bundle operations complete
            setTimeout(() => {
              document.body.classList.remove('kaching-bundle-processing');
            }, 100);
          }
        }
      });
    });

    // Watch for Kaching Bundle widgets
    const kachingWidgets = document.querySelectorAll('kaching-bundle, kaching-bundles-block, .kaching-bundles');
    kachingWidgets.forEach(widget => {
      observer.observe(widget, { 
        attributes: true, 
        attributeFilter: ['class', 'data-processing', 'data-loading'],
        childList: true,
        subtree: true
      });
    });

    // Also watch document body for bundle processing classes
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Listen for Kaching Bundle events if they exist
    document.addEventListener('kaching:cart:adding', () => {
      document.body.classList.add('kaching-bundle-processing');
    });
    
    document.addEventListener('kaching:cart:added', () => {
      setTimeout(() => {
        document.body.classList.remove('kaching-bundle-processing');
      }, 200);
    });
  }

  interceptKachingRequests() {
    // Track rapid cart additions from Kaching Bundle
    let kachingRequestCount = 0;
    let kachingRequestTimer = null;

    // Override fetch to detect cart additions
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      
      // Detect cart add/update requests
      if (typeof url === 'string' && (url.includes('/cart/add') || url.includes('/cart/update'))) {
        // Check if this might be from Kaching Bundle based on stack trace or timing
        const stack = new Error().stack;
        if (stack && (stack.includes('kaching') || 
                     document.querySelector('kaching-bundle') ||
                     document.querySelector('kaching-bundles-block'))) {
          
          kachingRequestCount++;
          document.body.classList.add('kaching-bundle-processing');
          
          // Clear existing timer
          if (kachingRequestTimer) {
            clearTimeout(kachingRequestTimer);
          }
          
          // Set processing flag for multiple requests
          kachingRequestTimer = setTimeout(() => {
            kachingRequestCount = 0;
            document.body.classList.remove('kaching-bundle-processing');
          }, kachingRequestCount > 1 ? 500 : 200);
        }
      }
      
      return originalFetch.apply(this, args);
    };
  }

  disconnectedCallback() {
    if (this.cartUpdateUnsubscriber) {
      this.cartUpdateUnsubscriber();
    }
  }

  resetQuantityInput(id) {
    const input = this.querySelector(`#Quantity-${id}`);
    input.value = input.getAttribute('value');
    this.isEnterPressed = false;
  }

  setValidity(event, index, message) {
    event.target.setCustomValidity(message);
    event.target.reportValidity();
    this.resetQuantityInput(index);
    event.target.select();
  }

  validateQuantity(event) {
    const inputValue = parseInt(event.target.value);
    const index = event.target.dataset.index;
    let message = '';

    if (inputValue < event.target.dataset.min) {
      message = window.quickOrderListStrings.min_error.replace('[min]', event.target.dataset.min);
    } else if (inputValue > parseInt(event.target.max)) {
      message = window.quickOrderListStrings.max_error.replace('[max]', event.target.max);
    } else if (inputValue % parseInt(event.target.step) !== 0) {
      message = window.quickOrderListStrings.step_error.replace('[step]', event.target.step);
    }

    if (message) {
      this.setValidity(event, index, message);
    } else {
      event.target.setCustomValidity('');
      event.target.reportValidity();
      this.updateQuantity(
        index,
        inputValue,
        document.activeElement.getAttribute('name'),
        event.target.dataset.quantityVariantId
      );
    }
  }

  onChange(event) {
    this.validateQuantity(event);
  }

  onCartUpdate() {
    // Debounce cart updates for bundle apps that add multiple items rapidly
    if (this.bundleUpdateTimeout) {
      clearTimeout(this.bundleUpdateTimeout);
    }
    
    this.bundleUpdateTimeout = setTimeout(() => {
      this.performCartUpdate();
    }, 150); // Short delay to batch rapid updates
  }

  performCartUpdate() {
    if (this.tagName === 'CART-DRAWER-ITEMS') {
      fetch(`${routes.cart_url}?section_id=cart-drawer`)
        .then((response) => response.text())
        .then((responseText) => {
          const html = new DOMParser().parseFromString(responseText, 'text/html');
          const selectors = ['cart-drawer-items', '.cart-drawer__footer'];
          for (const selector of selectors) {
            const targetElement = document.querySelector(selector);
            const sourceElement = html.querySelector(selector);
            if (targetElement && sourceElement) {
              targetElement.replaceWith(sourceElement);
            }
          }

                    const parsedStateElement = html.querySelector('[data-cart-drawer-state]');
          const parsedState = parsedStateElement ? JSON.parse(parsedStateElement.textContent) : null;
          this.updateCartUpsellToggleState();
          if (parsedState) {
            this.updateCartUpsellVisibility(parsedState.item_count);
          }

          
        })
        .catch((e) => {
          console.error(e);
        });
    } else {
      fetch(`${routes.cart_url}?section_id=main-cart-items`)
        .then((response) => response.text())
        .then((responseText) => {
          const html = new DOMParser().parseFromString(responseText, 'text/html');
          const sourceQty = html.querySelector('cart-items');
          this.innerHTML = sourceQty.innerHTML;

                    const parsedStateElement = html.querySelector('[data-cart-state]');
          const parsedState = parsedStateElement ? JSON.parse(parsedStateElement.textContent) : null;
          this.updateCartUpsellToggleState();
          if (parsedState) {
            this.updateCartUpsellVisibility(parsedState.item_count);
          }

        })
        .catch((e) => {
          console.error(e);
        });
    }
  }


    updateCartUpsellToggleState() {
    const cartUpsellToggle = document.getElementById('cart-upsell-toggle');
    const cartUpsellToggle2 = document.getElementById('cart-upsell-toggle-2');
       const cartUpsellToggle3 = document.getElementById('cart-upsell-toggle-3');
   
      const scriptTag = document.querySelector('script[data-cart-upsell-variant-id]');
    const cartUpsellVariantId = scriptTag ? scriptTag.dataset.cartUpsellVariantId : '';

    const scriptTag2 = document.querySelector('script[data-cart-upsell-variant-id2]');
    const cartUpsellVariantId2 = scriptTag2 ? scriptTag2.dataset.cartUpsellVariantId2 : '';
  
          const scriptTag3 = document.querySelector('script[data-cart-upsell-variant-id3]');
    const cartUpsellVariantId3 = scriptTag3 ? scriptTag3.dataset.cartUpsellVariantId3 : '';

      
      const cartItems = document.querySelectorAll('.cart-item');

    const upsellItem = Array.from(cartItems).find(item => {
      const input = item.querySelector('input[data-quantity-variant-id]');
      return input && input.getAttribute('data-quantity-variant-id') === cartUpsellVariantId;
    });

    const upsellItem2 = Array.from(cartItems).find(item => {
      const input = item.querySelector('input[data-quantity-variant-id]');
      return input && input.getAttribute('data-quantity-variant-id') === cartUpsellVariantId2;
    });


        const upsellItem3 = Array.from(cartItems).find(item => {
      const input = item.querySelector('input[data-quantity-variant-id]');
      return input && input.getAttribute('data-quantity-variant-id') === cartUpsellVariantId3;
    });
      

    if (cartUpsellToggle && cartUpsellToggle.checked !== !!upsellItem) {
      cartUpsellToggle.checked = !!upsellItem;
    }

    if (cartUpsellToggle2 && cartUpsellToggle2.checked !== !!upsellItem2) {
      cartUpsellToggle2.checked = !!upsellItem2;
    }


        if (cartUpsellToggle3 && cartUpsellToggle3.checked !== !!upsellItem3) {
      cartUpsellToggle3.checked = !!upsellItem3;
    }

      
  }

  updateCartUpsellVisibility(itemCount) {
    const cartUpsellContainer = document.querySelector('.cart-upsell-toggle-container');
    if (cartUpsellContainer) {
      if (itemCount === 0) {
        cartUpsellContainer.classList.add('hidden');
      } else {
        cartUpsellContainer.classList.remove('hidden');
      }
    }
  }

  onCartUpsellToggle(event) {
    // Skip processing if Kaching Bundle is actively adding items
    if (document.body.classList.contains('kaching-bundle-processing') || 
        document.querySelector('kaching-bundle')?.hasAttribute('data-processing') ||
        document.querySelector('kaching-bundles-block')?.classList.contains('processing')) {
      return;
    }

    const drawerWrapper = document.querySelector('.drawer__cart-items-wrapper');
    
    if (drawerWrapper) {
      drawerWrapper.classList.add('upsell-processing');
    }
    const drawerFooter = document.querySelector('.cart-drawer__footer');
    if (drawerFooter) {
      drawerFooter.classList.add('upsell-processing');
    }


    setTimeout(() => {
      document.body.classList.remove("upsell-processing");
    }, 300);

    const scriptTag = document.querySelector('script[data-cart-upsell-variant-id]');
    const cartUpsellVariantId = scriptTag ? scriptTag.dataset.cartUpsellVariantId : '';
    const isChecked = event.target.checked;

    if (isChecked) {
      this.addUpsellProduct(cartUpsellVariantId);
    } else {
      if (!this.removingUpsellProduct) {
        this.removingUpsellProduct = true;
        this.removeUpsellProduct(cartUpsellVariantId);


        if (this.tagName === 'CART-DRAWER-ITEMS') {
          event.stopImmediatePropagation();
        }
      }
    }
  }

  onCartUpsellToggle2(event) {
    // Skip processing if Kaching Bundle is actively adding items
    if (document.body.classList.contains('kaching-bundle-processing') || 
        document.querySelector('kaching-bundle')?.hasAttribute('data-processing') ||
        document.querySelector('kaching-bundles-block')?.classList.contains('processing')) {
      return;
    }

    const drawerWrapper = document.querySelector('.drawer__cart-items-wrapper');
    if (drawerWrapper) {
      drawerWrapper.classList.add('upsell-processing');
    }
    const drawerFooter = document.querySelector('.cart-drawer__footer');
    if (drawerFooter) {
      drawerFooter.classList.add('upsell-processing');
    }

    const scriptTag = document.querySelector('script[data-cart-upsell-variant-id2]');
    const cartUpsellVariantId2 = scriptTag ? scriptTag.dataset.cartUpsellVariantId2 : '';
    const isChecked = event.target.checked;

    if (isChecked) {
      this.addUpsellProduct(cartUpsellVariantId2);
    } else {
      if (!this.removingUpsellProduct) {
        this.removingUpsellProduct = true;
        this.removeUpsellProduct(cartUpsellVariantId2);

        if (this.tagName === 'CART-DRAWER-ITEMS') {
          event.stopImmediatePropagation();
        }
      }
    }
  }


  onCartUpsellToggle3(event) {
    // Skip processing if Kaching Bundle is actively adding items
    if (document.body.classList.contains('kaching-bundle-processing') || 
        document.querySelector('kaching-bundle')?.hasAttribute('data-processing') ||
        document.querySelector('kaching-bundles-block')?.classList.contains('processing')) {
      return;
    }

    const drawerWrapper = document.querySelector('.drawer__cart-items-wrapper');
    if (drawerWrapper) {
      drawerWrapper.classList.add('upsell-processing');
    }
    const drawerFooter = document.querySelector('.cart-drawer__footer');
    if (drawerFooter) {
      drawerFooter.classList.add('upsell-processing');
    }

    const scriptTag = document.querySelector('script[data-cart-upsell-variant-id3]');
    const cartUpsellVariantId3 = scriptTag ? scriptTag.dataset.cartUpsellVariantId3 : '';
    const isChecked = event.target.checked;
    if (isChecked) {
      this.addUpsellProduct(cartUpsellVariantId3);
    } else {
      if (!this.removingUpsellProduct) {
        this.removingUpsellProduct = true;
        this.removeUpsellProduct(cartUpsellVariantId3);

        if (this.tagName === 'CART-DRAWER-ITEMS') {
          event.stopImmediatePropagation();
        }
      }
    }
  }


  async addUpsellProduct(cartUpsellVariantId) {
    const upsellFormData = new FormData();
    upsellFormData.append('id', cartUpsellVariantId);
    upsellFormData.append('quantity', 1);

    const config = fetchConfig('javascript');
    config.headers['X-Requested-With'] = 'XMLHttpRequest';
    delete config.headers['Content-Type'];
    config.body = upsellFormData;

    const response = await fetch(`${routes.cart_add_url}`, config);
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to add upsell product:', errorText);
      throw new Error('Failed to add upsell product');
    }

    this.onCartUpdate();
  }

  async removeUpsellProduct(cartUpsellVariantId) {
    const cartItems = document.querySelectorAll('.cart-item');

    const upsellItem = Array.from(cartItems).find(item => {
      const input = item.querySelector('input[data-quantity-variant-id]');
      return input && input.getAttribute('data-quantity-variant-id') === cartUpsellVariantId;
    });

    if (!upsellItem) {
      console.error('Upsell product not found in the cart.');
      return;
    }

    const upsellIndex = upsellItem.querySelector('input[data-index]').dataset.index;

    try {
      await this.updateQuantity(upsellIndex, 0, null, cartUpsellVariantId);
      this.removingUpsellProduct = false;
    } catch (error) {
      console.error('Error removing upsell product:', error);
      this.removingUpsellProduct = false;
    }
  }


  getSectionsToRender() {
    return [
      {
        id: 'main-cart-items',
        section: document.getElementById('main-cart-items').dataset.id,
        selector: '.js-contents',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
      {
        id: 'cart-live-region-text',
        section: 'cart-live-region-text',
        selector: '.shopify-section',
      },
      {
        id: 'main-cart-footer',
        section: document.getElementById('main-cart-footer').dataset.id,
        selector: '.js-contents',
      },
    ];
  }

  updateQuantity(line, quantity, name, variantId) {
    this.enableLoading(line);

    const body = JSON.stringify({
      line,
      quantity,
      sections: this.getSectionsToRender().map((section) => section.section),
      sections_url: window.location.pathname,
    });

    fetch(`${routes.cart_change_url}`, { ...fetchConfig(), ...{ body } })
      .then((response) => {
        return response.text();
      })
      .then((state) => {
        const parsedState = JSON.parse(state);
        const quantityElement =
          document.getElementById(`Quantity-${line}`) || document.getElementById(`Drawer-quantity-${line}`);
        const items = document.querySelectorAll('.cart-item');

        if (parsedState.errors) {
          quantityElement.value = quantityElement.getAttribute('value');
          this.updateLiveRegions(line, parsedState.errors);
          return;
        }

        this.classList.toggle('is-empty', parsedState.item_count === 0);
        const cartDrawerWrapper = document.querySelector('cart-drawer');
        const cartFooter = document.getElementById('main-cart-footer');

        if (cartFooter) cartFooter.classList.toggle('is-empty', parsedState.item_count === 0);
        if (cartDrawerWrapper) cartDrawerWrapper.classList.toggle('is-empty', parsedState.item_count === 0);

        this.getSectionsToRender().forEach((section) => {
          const elementToReplace =
            document.getElementById(section.id).querySelector(section.selector) || document.getElementById(section.id);
          elementToReplace.innerHTML = this.getSectionInnerHTML(
            parsedState.sections[section.section],
            section.selector
          );
        });
        const updatedValue = parsedState.items[line - 1] ? parsedState.items[line - 1].quantity : undefined;
        let message = '';
        if (items.length === parsedState.items.length && updatedValue !== parseInt(quantityElement.value)) {
          if (typeof updatedValue === 'undefined') {
            message = window.cartStrings.error;
          } else {
            message = window.cartStrings.quantityError.replace('[quantity]', updatedValue);
          }
        }
        this.updateLiveRegions(line, message);

        const lineItem =
          document.getElementById(`CartItem-${line}`) || document.getElementById(`CartDrawer-Item-${line}`);
        if (lineItem && lineItem.querySelector(`[name="${name}"]`)) {
          cartDrawerWrapper
            ? trapFocus(cartDrawerWrapper, lineItem.querySelector(`[name="${name}"]`))
            : lineItem.querySelector(`[name="${name}"]`).focus();
        } else if (parsedState.item_count === 0 && cartDrawerWrapper) {
          trapFocus(cartDrawerWrapper.querySelector('.drawer__inner-empty'), cartDrawerWrapper.querySelector('a'));
        } else if (document.querySelector('.cart-item') && cartDrawerWrapper) {
          trapFocus(cartDrawerWrapper, document.querySelector('.cart-item__name'));
        }

        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'cart-items', cartData: parsedState, variantId: variantId });

                this.updateCartUpsellToggleState();
        this.updateCartUpsellVisibility(parsedState.item_count);

      })
      .catch(() => {
        this.querySelectorAll('.loading__spinner').forEach((overlay) => overlay.classList.add('hidden'));
        const errors = document.getElementById('cart-errors') || document.getElementById('CartDrawer-CartErrors');
        errors.textContent = window.cartStrings.error;
      })
      .finally(() => {
        this.disableLoading(line);
      });
  }

  updateLiveRegions(line, message) {
    const lineItemError =
      document.getElementById(`Line-item-error-${line}`) || document.getElementById(`CartDrawer-LineItemError-${line}`);
    if (lineItemError) lineItemError.querySelector('.cart-item__error-text').innerHTML = message;

    this.lineItemStatusElement.setAttribute('aria-hidden', true);

    const cartStatus =
      document.getElementById('cart-live-region-text') || document.getElementById('CartDrawer-LiveRegionText');
    cartStatus.setAttribute('aria-hidden', false);

    setTimeout(() => {
      cartStatus.setAttribute('aria-hidden', true);
    }, 200);
  }

  getSectionInnerHTML(html, selector) {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector).innerHTML;
  }

  enableLoading(line) {
    const mainCartItems = document.getElementById('main-cart-items') || document.getElementById('CartDrawer-CartItems');
    mainCartItems.classList.add('cart__items--disabled');

    const cartItemElements = this.querySelectorAll(`#CartItem-${line} .loading__spinner`);
    const cartDrawerItemElements = this.querySelectorAll(`#CartDrawer-Item-${line} .loading__spinner`);

    [...cartItemElements, ...cartDrawerItemElements].forEach((overlay) => overlay.classList.remove('hidden'));

    document.activeElement.blur();
    this.lineItemStatusElement.setAttribute('aria-hidden', false);
  }

  disableLoading(line) {
    const mainCartItems = document.getElementById('main-cart-items') || document.getElementById('CartDrawer-CartItems');
    mainCartItems.classList.remove('cart__items--disabled');

    const cartItemElements = this.querySelectorAll(`#CartItem-${line} .loading__spinner`);
    const cartDrawerItemElements = this.querySelectorAll(`#CartDrawer-Item-${line} .loading__spinner`);

    cartItemElements.forEach((overlay) => overlay.classList.add('hidden'));
    cartDrawerItemElements.forEach((overlay) => overlay.classList.add('hidden'));
  }
}

customElements.define('cart-items', CartItems);

if (!customElements.get('cart-note')) {
  customElements.define(
    'cart-note',
    class CartNote extends HTMLElement {
      constructor() {
        super();

        this.addEventListener(
          'input',
          debounce((event) => {
            const body = JSON.stringify({ note: event.target.value });
            fetch(`${routes.cart_update_url}`, { ...fetchConfig(), ...{ body } });
          }, ON_CHANGE_DEBOUNCE_TIMER)
        );
      }
    }
  );
}



