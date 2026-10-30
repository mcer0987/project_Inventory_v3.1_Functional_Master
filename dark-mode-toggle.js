/**
 * dark-mode-toggle.js
 * Flicker-free, localStorage tabanlı dark mode toggle.
 * Her iki sayfada da (index.html + admin.html) çalışır.
 */

(function () {
    // ── 1. Sayfa yüklenmeden ÖNCE temayı uygula (flicker engeli) ──────────────
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // Geçiş sırasında transition'ı geçici olarak kapat (ilk yükleme flash'ını önler)
    document.documentElement.classList.add('no-transition');
    window.addEventListener('load', () => {
        requestAnimationFrame(() => {
            document.documentElement.classList.remove('no-transition');
        });
    });
})();

/**
 * Temayı light ↔ dark arasında değiştirir.
 * Toggle butonlarından çağrılır.
 */
function toggleTheme() {
    const root = document.documentElement;
    const isDark = root.getAttribute('data-theme') === 'dark';
    const next   = isDark ? 'light' : 'dark';

    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);

    // Buton ikonlarını güncelle (her iki sayfadaki tüm toggle butonları)
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.innerHTML = next === 'dark'
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
        btn.title = next === 'dark' ? 'Açık Temaya Geç' : 'Koyu Temaya Geç';
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-pressed', String(next === 'dark'));
    });

    // Chart.js grafikleri tema geçişine duyarlı değil — transition bitmeden
    // (300ms) resize event göndererek yeniden ölçeklenmelerini tetikle.
    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));

        // Admin panelinde dashboard görünürse grafikleri yeniden çiz
        if (typeof window.renderDashboardStats === 'function') {
            const dash = document.getElementById('dashboard-content');
            if (dash && dash.style.display !== 'none') {
                window.renderDashboardStats();
            }
        }
    }, 350); // CSS transition süresi (0.3s) + biraz tampon
}

// Sayfa hazır olduğunda buton ikonlarını doğru duruma getir
document.addEventListener('DOMContentLoaded', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        btn.innerHTML = isDark
            ? '<i class="fas fa-sun"></i>'
            : '<i class="fas fa-moon"></i>';
        btn.title = isDark ? 'Açık Temaya Geç' : 'Koyu Temaya Geç';
        btn.setAttribute('aria-label', btn.title);
        btn.setAttribute('aria-pressed', String(isDark));
    });
});
