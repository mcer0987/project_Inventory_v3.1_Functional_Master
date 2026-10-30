(function () {
    'use strict';

    function setupMobileNavigation() {
        const shell = document.querySelector('.tabs-scroll-shell');
        const tabs = document.getElementById('mainTabs');
        if (!shell || !tabs) return;

        const updateScrollState = () => {
            const maxScroll = tabs.scrollWidth - tabs.clientWidth;
            shell.classList.toggle('has-more-before', tabs.scrollLeft > 2);
            shell.classList.toggle('has-more-after', maxScroll - tabs.scrollLeft > 2);
        };

        const updateCurrentTab = () => {
            tabs.querySelectorAll('.tab-button, .tab-btn').forEach(button => {
                if (button.classList.contains('active')) {
                    button.setAttribute('aria-current', 'page');
                } else {
                    button.removeAttribute('aria-current');
                }
            });
        };

        tabs.addEventListener('scroll', updateScrollState, { passive: true });
        tabs.addEventListener('click', event => {
            if (event.target.closest('.tab-button, .tab-btn')) {
                requestAnimationFrame(updateCurrentTab);
            }
        });
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(updateScrollState).observe(tabs);
        } else {
            window.addEventListener('resize', updateScrollState, { passive: true });
        }
        new MutationObserver(updateCurrentTab).observe(tabs, {
            attributes: true,
            attributeFilter: ['class'],
            subtree: true
        });

        updateScrollState();
        updateCurrentTab();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupMobileNavigation, { once: true });
    } else {
        setupMobileNavigation();
    }
})();
