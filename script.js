// État de l'application
let manhwaLibrary = [];
let currentTab = 'all';
let currentManhwaId = null;
let chapterInputBuffer = '';
let chapterInputTimeout = null;
let activeNotifications = [];
let settings = {
    refreshButtonEnabled: true,
    autoCheckEnabled: true,
    notificationsEnabled: true,
    darkModeEnabled: false,
    compactModeEnabled: false,
    animationsEnabled: true,
    cardSize: 'medium',
    defaultSort: 'title'
};
const APP_VERSION = '1.5.8';
const NOTIFICATIONS_KEY = "ixwha_notifications";
const VISIT_COUNTER_KEY = "ixwha_visit_counter";
const DISCORD_NOTIFICATION_SENT_KEY = "ixwha_discord_notification_sent";
const LAST_CHECK_KEY = "ixwha_last_check";
const CHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 1 semaine en millisecondes
const SETTINGS_KEY = "ixwha_settings";

// Constantes pour la gestion des notifications Discord et des retries
const DISCORD_NOTIFICATION_HISTORY_KEY = "ixwha_discord_notification_history";
const NOTIFICATION_COOLDOWN = 24 * 60 * 60 * 1000; // 24 heures en millisecondes
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 secondes
const MAX_NOTIFICATIONS_PER_DAY = 5;

// Constantes pour les statistiques Discord
const DISCORD_STATS_KEY = "ixwha_discord_stats";
const DISCORD_FEEDBACK_KEY = "ixwha_discord_feedback";
const DISCORD_LAST_HEALTH_CHECK = "ixwha_last_health_check";
const HEALTH_CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 heures

// Variables pour le scroll
let lastScrollTop = 0;
let scrollTimeout;

// Structure pour les statistiques
const defaultStats = {
    totalVisits: 0,
    uniqueUsers: new Set(),
    lastUpdate: null,
    updateHistory: [],
    systemHealth: {
        lastCheck: null,
        status: 'operational',
        errors: []
    }
};

// Remplacer la classe DataManager par des fonctions simples
async function saveLibrary() {
    const libraryData = manhwaLibrary.map(manhwa => ({
        ...manhwa,
        readChapters: Array.from(manhwa.readChapters)
    }));
    localStorage.setItem('manhwaLibrary', JSON.stringify(libraryData));
}

async function loadLibrary() {
    try {
        const saved = localStorage.getItem('manhwaLibrary');
        if (saved) {
            manhwaLibrary = JSON.parse(saved).map(manhwa => ({
                ...manhwa,
                readChapters: new Set(manhwa.readChapters || []),
                isFavorite: manhwa.isFavorite || false
            }));
        }
    } catch (error) {
        console.error("Erreur lors du chargement de la bibliothèque:", error);
        manhwaLibrary = [];
    }
    renderLibrary();
}



// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Charger les données
        await loadLibrary();
        loadSettings();
        initEventListeners();
        checkFirstVisit();
        checkForUpdates();
        initNotificationSystem();
        
        // Vérifier les nouveaux chapitres
        checkNewChapters();
        
        // Configurer la vérification périodique
        setInterval(checkNewChapters, CHECK_INTERVAL);
        
    } catch (error) {
        console.error("Erreur lors de l'initialisation:", error);
        showAlert("Une erreur est survenue lors du chargement de l'application. Veuillez réessayer.");
    }
});

// Fonctions utilitaires
const $ = id => document.getElementById(id);
const isMobileDevice = () => (window.innerWidth <= 768) || 
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Gestion des événements
function initEventListeners() {
    // Boutons principaux
    $('addButton')?.addEventListener('click', openAddModal);
    $('legalButton')?.addEventListener('click', () => openModal('legalModal'));
    $('searchInput')?.addEventListener('input', renderLibrary);
    $('helpButton')?.addEventListener('click', () => openModal('helpModal'));
    
    // Modals
    const modalClosures = {
        'helpModal': 'helpCloseBtn',
        'welcomeModal': 'welcomeCloseBtn',
        'legalModal': 'legalCloseBtn',
        'updateModal': 'updateCloseBtn',
        'deleteModal': 'cancelDeleteBtn',
        'resetProgressModal': 'cancelResetBtn',
        'chaptersModal': 'closeChaptersBtn'
    };
    
    Object.entries(modalClosures).forEach(([modal, btn]) => {
        $(btn)?.addEventListener('click', () => closeModal(modal));
    });
    
    // Actions spécifiques
    $('manhwaForm').addEventListener('submit', handleManhwaFormSubmit);
    $('editCancelBtn').addEventListener('click', () => closeModal('editModal'));
    $('resetBtn').addEventListener('click', () => openModal('resetProgressModal'));
    $('confirmResetBtn').addEventListener('click', confirmResetProgress);
    $('confirmDeleteBtn').addEventListener('click', confirmDelete);
    
    // Fermeture de updateModal avec sauvegarde de la version
    $('updateCloseBtn').addEventListener('click', () => {
        closeModal('updateModal');
        localStorage.setItem('lastViewedVersion', APP_VERSION);
    });
    
    // Onglets
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    
    // Extraction URL
    $('readUrlInput').addEventListener('blur', async function() {
        const url = this.value.trim();
        if (!url) return;
        
        this.classList.add('loading');
        const info = await extractInfoFromUrl(url);
        this.classList.remove('loading');
        
        if (info) {
            if (info.title && !$('titleInput').value.trim()) {
                $('titleInput').value = info.title;
            }
            if (info.cover && !$('coverInput').value.trim()) {
                $('coverInput').value = info.cover;
            }
        }
    });
    
    // Fermeture des modals en cliquant en dehors
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal.id);
        });
    });
    
    // Support swipe sur mobile
    if (isMobileDevice()) {
        setupSwipeSupport();
        enableMobileMode();
    }
    
    // Redimensionnement
    window.addEventListener('resize', handleResize);
    
    // Raccourcis clavier
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Bouton d'actualisation
    $('refreshButton').addEventListener('click', () => {
        const button = $('refreshButton');
        button.classList.add('loading');
        forceCheckNewChapters().finally(() => {
            button.classList.remove('loading');
        });
    });
    
    // Paramètres
    const settingsButton = $('settingsButton');
    const mobileSettingsButton = $('mobileSettingsButton');
    const settingsCloseBtn = $('settingsCloseBtn');
    const settingsModal = $('settingsModal');
    
    // Gestion du bouton des paramètres (desktop)
    if (!settingsButton) {
        console.error('Le bouton des paramètres (desktop) est introuvable dans le DOM');
    } else {
        console.log('Bouton des paramètres (desktop) trouvé, ajout du listener');
        settingsButton.addEventListener('click', () => {
            console.log('Clic sur le bouton des paramètres (desktop)');
            if (!settingsModal) {
                console.error('Le modal des paramètres est introuvable dans le DOM');
            } else {
                openModal('settingsModal');
            }
        });
    }
    
    // Gestion du bouton des paramètres (mobile)
    if (!mobileSettingsButton) {
        console.error('Le bouton des paramètres (mobile) est introuvable dans le DOM');
    } else {
        console.log('Bouton des paramètres (mobile) trouvé, ajout du listener');
        mobileSettingsButton.addEventListener('click', () => {
            console.log('Clic sur le bouton des paramètres (mobile)');
            if (!settingsModal) {
                console.error('Le modal des paramètres est introuvable dans le DOM');
            } else {
                openModal('settingsModal');
                // Fermer le menu mobile
                const mobileMenu = document.getElementById('mobileMenu');
                const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
                if (mobileMenu) mobileMenu.classList.remove('active');
                if (mobileMenuOverlay) mobileMenuOverlay.classList.remove('active');
            }
        });
    }
    
    // Gestion du bouton de fermeture
    if (!settingsCloseBtn) {
        console.error('Le bouton de fermeture des paramètres est introuvable dans le DOM');
    } else {
        console.log('Bouton de fermeture des paramètres trouvé, ajout du listener');
        settingsCloseBtn.addEventListener('click', () => {
            console.log('Fermeture du modal des paramètres');
            closeModal('settingsModal');
        });
    }
    
    // Toggles des paramètres
    const toggles = {
        'refreshButtonToggle': 'refreshButtonEnabled',
        'autoCheckToggle': 'autoCheckEnabled',
        'notificationsToggle': 'notificationsEnabled',
        'darkModeToggle': 'darkModeEnabled',
        'compactModeToggle': 'compactModeEnabled',
        'animationsToggle': 'animationsEnabled'
    };
    
    Object.entries(toggles).forEach(([elementId, settingKey]) => {
        const element = $(elementId);
        if (element) {
            // Initialiser l'état du toggle
            element.checked = settings[settingKey];
            // Ajouter le listener
            element.addEventListener('change', (e) => {
                console.log(`Modification du paramètre ${settingKey}: ${e.target.checked}`);
                updateSetting(settingKey, e.target.checked);
            });
        } else {
            console.error(`Toggle ${elementId} introuvable dans le DOM`);
        }
    });
    
    // Sélecteurs
    const selects = {
        'cardSizeSelect': 'cardSize',
        'defaultSortSelect': 'defaultSort'
    };
    
    Object.entries(selects).forEach(([elementId, settingKey]) => {
        const element = $(elementId);
        if (element) {
            // Initialiser la valeur du select
            element.value = settings[settingKey];
            // Ajouter le listener
            element.addEventListener('change', (e) => {
                console.log(`Modification du paramètre ${settingKey}: ${e.target.value}`);
                updateSetting(settingKey, e.target.value);
            });
        } else {
            console.error(`Select ${elementId} introuvable dans le DOM`);
        }
    });
}

function setupSwipeSupport() {
    let touchStartX = 0, touchEndX = 0;
    const library = document.querySelector('.library');
    
    library.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, false);
    
    library.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, false);
    
    function handleSwipe() {
        const swipeThreshold = 100;
        
        if (touchEndX < touchStartX - swipeThreshold && currentTab === 'all') {
            showSwipeAnimation('left');
            setTimeout(() => switchTab('completed'), 150);
        }
        
        if (touchEndX > touchStartX + swipeThreshold && currentTab === 'completed') {
            showSwipeAnimation('right');
            setTimeout(() => switchTab('all'), 150);
        }
    }
}

function handleKeyboardShortcuts(e) {
    // Ignorer si dans un champ texte sauf pour Échap
    if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal').forEach(modal => {
                if (modal.style.display === 'block') {
                    closeModal(modal.id);
                    e.preventDefault();
                }
            });
        }
        return;
    }
    
    // Navigation onglets avec Alt+chiffre
    if (e.altKey) {
        if (e.key === '1') switchTab('all');
        else if (e.key === '2') switchTab('completed');
        else if (e.key === '3') switchTab('dropped');
        else if (e.key === '4') switchTab('favorites');
        e.preventDefault();
        return;
    }
    
    // Autres raccourcis
    const shortcuts = {
        'a': openAddModal,
        '+': openAddModal,
        's': () => $('searchInput').focus(),
        'l': () => openModal('legalModal'),
        'Escape': () => {
            document.querySelectorAll('.modal').forEach(modal => {
                if (modal.style.display === 'block') closeModal(modal.id);
            })
        }
    };
    
    if (shortcuts[e.key]) {
        shortcuts[e.key]();
        e.preventDefault();
    }
    
    // Gestion du chapitre modal s'il est ouvert
    const chaptersModal = $('chaptersModal');
    if (chaptersModal?.style.display === 'block') {
        // Touches numériques pour chapitres
        if (!isNaN(parseInt(e.key))) {
            chapterInputBuffer += e.key;
            clearTimeout(chapterInputTimeout);
            
            chapterInputTimeout = setTimeout(() => {
                const chapterNumber = parseInt(chapterInputBuffer, 10);
                if (!isNaN(chapterNumber) && chapterNumber > 0) {
                    toggleChapter(chapterNumber);
                }
                chapterInputBuffer = '';
            }, 500);
            
            e.preventDefault();
        }
        
        // Réinitialisation
        if (e.key === 'r') {
            openModal('resetProgressModal');
            e.preventDefault();
        }
    }
}

// Gestion modals et UI
function openModal(modalId) {
    const modal = $(modalId);
    if (!modal) {
        console.error(`Le modal ${modalId} est introuvable dans le DOM`);
        return;
    }
    console.log(`Ouverture du modal ${modalId}`);
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
    $(modalId).style.display = 'none';
    document.body.style.overflow = '';
    
    if (modalId === 'editModal') {
        $('manhwaForm').reset();
        currentManhwaId = null;
    }
}

function checkFirstVisit() {
    if (!localStorage.getItem('hasVisited')) {
        openModal('welcomeModal');
        localStorage.setItem('hasVisited', 'true');
    }
    loadLibrary();
    updateVersionDisplay();
}

async function checkForUpdates() {
    const lastViewedVersion = localStorage.getItem('lastViewedVersion');
    console.log('Version actuelle:', APP_VERSION);
    console.log('Dernière version vue:', lastViewedVersion);

    try {
        // Utiliser un chemin absolu
        const res = await fetch('/updates.json', {
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (!res.ok) {
            console.error(`Impossible de charger updates.json (${res.status}: ${res.statusText})`);
            return;
        }
        
        const updates = await res.json();
        console.log('Données de mises à jour chargées:', updates);

        const updateInfo = updates[APP_VERSION];
        if (!updateInfo) {
            console.log('Aucune information de mise à jour trouvée pour la version', APP_VERSION);
            return;
        }

        // Vérifier si c'est une nouvelle version qui n'a jamais été vue
        if (!lastViewedVersion || lastViewedVersion !== APP_VERSION) {
            console.log('Nouvelle version détectée, préparation de l\'affichage');
            const html = getUpdateNotes(APP_VERSION, lastViewedVersion, updates);
            
            const updateContent = document.getElementById('updateContent');
            if (updateContent) {
                updateContent.innerHTML = html;
                
                // Afficher le modal
                const updateModal = document.getElementById('updateModal');
                if (updateModal) {
                    updateModal.style.display = 'block';
                    document.body.style.overflow = 'hidden';
                    
                    // Envoyer la notification Discord à chaque fois qu'une nouvelle version est détectée
                    sendDiscordNotification(APP_VERSION, updateInfo);
                } else {
                    console.error("Modal de mise à jour non trouvé");
                }
            } else {
                console.error("Element updateContent non trouvé");
            }
        } else {
            console.log('Version déjà vue, pas d\'affichage nécessaire');
        }

    } catch (err) {
        console.error('Erreur lors du chargement des mises à jour:', err);
        // Ne pas bloquer l'application si les mises à jour ne peuvent pas être chargées
        console.log('Continuation de l\'application malgré l\'erreur de mise à jour');
    }
}

function getUpdateNotes(currentVersion, previousVersion, updates) {
    let html = '';

    if (previousVersion) {
        html += `<p class="update-info">Mise à jour de ${previousVersion} vers ${currentVersion}</p>`;
    }

    const info = updates[currentVersion];
    if (info) {
        html += `
            <div class="update-notes">
                <p class="update-date">Version ${currentVersion} - ${info.date}</p>
                <ul class="feature-list">
                    ${info.features.map(f => `<li>${f}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    return html;
}

// Rendu UI
function createManhwaCard(manhwa) {
    const progress = manhwa.totalChapters > 0 ? (manhwa.readChapters.size / manhwa.totalChapters) * 100 : 0;
    const nextChapter = getNextUnreadChapter(manhwa);
    const readUrl = buildReadUrl(manhwa.readUrl, nextChapter);
    const defaultImage = '/api/placeholder/200/280';

    const card = document.createElement('div');
    card.className = `manhwa-card${manhwa.isFavorite ? ' favorite' : ''}${manhwa.isDropped ? ' dropped' : ''}`;
    
    card.innerHTML = `
        <div class="edit-buttons">
            <button class="favorite-button ${manhwa.isFavorite ? 'active' : ''}" title="${manhwa.isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">⭐</button>
            <button class="drop-button ${manhwa.isDropped ? 'active' : ''}" title="${manhwa.isDropped ? 'Reprendre la lecture' : 'Abandonner'}">❌</button>
            <button class="edit-button" title="Modifier">✏️</button>
            <button class="delete-button" title="Supprimer">🗑️</button>
        </div>
        <div class="cover-container">
            <img src="${manhwa.cover || defaultImage}" 
                 alt="${manhwa.title}" 
                 class="cover-image"
                 onerror="this.onerror=null; this.src='${defaultImage}';">
        </div>
        <div class="manhwa-info">
            <h3 class="manhwa-title" title="${manhwa.title}">${manhwa.title}</h3>
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill ${progress === 100 ? 'animated' : ''}" style="width: ${progress}%"></div>
                </div>
                <div class="chapter-info">
                    <span>${manhwa.readChapters.size}/${manhwa.totalChapters || '?'} chapitres</span>
                    <a href="${readUrl}" target="_blank" class="read-button">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M12.232 4.232a2.5 2.5 0 013.536 3.536l-1.225 1.224a.75.75 0 001.061 1.06l1.224-1.224a4 4 0 00-5.656-5.656l-3 3a4 4 0 00.225 5.865.75.75 0 00.977-1.138 2.5 2.5 0 01-.142-3.667l3-3z" />
                            <path d="M11.603 7.963a.75.75 0 00-.977 1.138 2.5 2.5 0 01.142 3.667l-3 3a2.5 2.5 0 01-3.536-3.536l1.225-1.224a.75.75 0 00-1.061-1.06l-1.224 1.224a4 4 0 105.656 5.656l3-3a4 4 0 00-.225-5.865z" />
                        </svg>
                        Lire
                    </a>
                </div>
            </div>
        </div>
    `;

    // Événements
    card.querySelector('.favorite-button').addEventListener('click', (e) => toggleFavorite(manhwa.id, e));
    card.querySelector('.drop-button').addEventListener('click', (e) => toggleDropped(manhwa.id, e));
    card.querySelector('.edit-button').addEventListener('click', (e) => {
        e.stopPropagation();
        editManhwa(manhwa.id);
    });
    card.querySelector('.delete-button').addEventListener('click', (e) => {
        e.stopPropagation();
        openDeleteModal(manhwa.id);
    });
    card.querySelector('.read-button').addEventListener('click', (e) => e.stopPropagation());
    card.addEventListener('click', () => openChapters(manhwa.id));
    
    return card;
}

function renderLibrary() {
    const library = $('library');
    library.innerHTML = '';

    let filteredManhwa = manhwaLibrary;
    const searchTerm = $('searchInput').value.toLowerCase().trim();

    // Filtrage
    if (searchTerm) {
        filteredManhwa = filteredManhwa.filter(m => 
            m.title.toLowerCase().includes(searchTerm)
        );
    }

    if (currentTab === 'completed') {
        filteredManhwa = filteredManhwa.filter(m => 
            m.readChapters.size === m.totalChapters && m.totalChapters > 0
        );
    } else if (currentTab === 'dropped') {
        filteredManhwa = filteredManhwa.filter(m => m.isDropped);
    } else if (currentTab === 'favorites') {
        filteredManhwa = filteredManhwa.filter(m => m.isFavorite);
    } else {
        filteredManhwa = filteredManhwa.filter(m => 
            m.readChapters.size < m.totalChapters && !m.isDropped
        );
    }

    // Tri: favoris d'abord, puis par titre
    filteredManhwa.sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return b.isFavorite - a.isFavorite;
        return a.title.localeCompare(b.title);
    });

    // Message si vide
    if (filteredManhwa.length === 0) {
        const message = searchTerm 
            ? 'Aucun manhwa trouvé pour cette recherche' 
            : currentTab === 'completed' 
                ? 'Aucun manhwa terminé pour le moment' 
                : currentTab === 'dropped'
                    ? 'Aucun manhwa abandonné'
                    : currentTab === 'favorites'
                        ? 'Aucun manhwa en favoris'
                        : 'Ajoutez votre premier manhwa en cliquant sur le bouton +';
                
        library.innerHTML = `<div class="empty-state">${message}</div>`;
        return;
    }

    // Ajouter les cartes
    filteredManhwa.forEach(manhwa => {
        library.appendChild(createManhwaCard(manhwa));
    });
}

// Gestion des chapitres
function openChapters(id) {
    const manhwa = manhwaLibrary.find(m => m.id === id);
    if (!manhwa) return;
    
    currentManhwaId = id;
    $('chaptersTitle').textContent = manhwa.title;

    const grid = $('chaptersGrid');
    grid.innerHTML = '';

    for (let i = 1; i <= manhwa.totalChapters; i++) {
        const chapter = document.createElement('div');
        chapter.className = `chapter-item ${manhwa.readChapters.has(i) ? 'read' : ''}`;
        chapter.textContent = i;
        chapter.addEventListener('click', () => toggleChapter(i));
        grid.appendChild(chapter);
    }

    openModal('chaptersModal');
}

function toggleChapter(chapterNumber) {
    const manhwa = manhwaLibrary.find(m => m.id === currentManhwaId);
    if (!manhwa) return;
    
    const isCurrentlyRead = manhwa.readChapters.has(chapterNumber);
    
    if (isCurrentlyRead) {
        // Désélectionner jusqu'à ce chapitre
        for (let i = chapterNumber; i <= manhwa.totalChapters; i++) {
            manhwa.readChapters.delete(i);
        }
    } else {
        // Sélectionner jusqu'à ce chapitre
        for (let i = 1; i <= chapterNumber; i++) {
            manhwa.readChapters.add(i);
        }
    }

    saveLibrary();
    renderLibrary();
    
    // Mise à jour visuelle
    const chapterItems = $('chaptersGrid').querySelectorAll('.chapter-item');
    chapterItems.forEach((item, index) => {
        item.classList.toggle('read', manhwa.readChapters.has(index + 1));
    });
}

function toggleFavorite(id, event) {
    event.stopPropagation();
    
    const manhwa = manhwaLibrary.find(m => m.id === id);
    if (!manhwa) return;
    
    manhwa.isFavorite = !manhwa.isFavorite;
    saveLibrary();
    renderLibrary();
}

function toggleDropped(id, event) {
    event.stopPropagation();
    
    const manhwa = manhwaLibrary.find(m => m.id === id);
    if (!manhwa) return;
    
    manhwa.isDropped = !manhwa.isDropped;
    saveLibrary();
    renderLibrary();
}

// Fonctions pour obtenir URLs et chapitres
function getNextUnreadChapter(manhwa) {
    for (let i = 1; i <= manhwa.totalChapters; i++) {
        if (!manhwa.readChapters.has(i)) return i;
    }
    return manhwa.totalChapters;
}

async function extractInfoFromUrl(url) {
    if (!url) {
        console.log("Aucune URL fournie");
        return null;
    }

    showLoading("Analyse de l'URL...");

    let result = {
        title: '',
        cover: '',
        totalChapters: 0,
        readUrl: url
    };

    try {
        if (url.includes('phenix-scans.com')) {
            // ... existing phenix-scans code ...
        } else if (url.includes('rimuscans.fr')) {
            console.log("URL de Rimu Scans détectée");
            updateLoadingMessage("Connexion à Rimu Scans...");
            
            // Liste des proxys à essayer avec des headers plus complets
            const proxyUrls = [
                {
                    url: `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                    headers: {
                        'Accept': 'application/json',
                        'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
                        'Referer': 'https://rimuscans.fr/'
                    }
                },
                {
                    url: `https://corsproxy.io/?${encodeURIComponent(url)}`,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
                        'Referer': 'https://rimuscans.fr/'
                    }
                },
                {
                    url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36',
                        'Referer': 'https://rimuscans.fr/'
                    }
                }
            ];

            let data = null;
            let proxyError = null;

            // Essayer chaque proxy jusqu'à ce qu'un fonctionne
            for (const proxy of proxyUrls) {
                try {
                    updateLoadingMessage("Tentative de récupération des informations...");
                    console.log("Tentative avec le proxy:", proxy.url);

                    const fetchData = async () => {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 30000); // Timeout augmenté à 30s

                        try {
                            const response = await fetch(proxy.url, {
                                headers: proxy.headers,
                                signal: controller.signal
                            });

                            clearTimeout(timeoutId);

                            if (!response.ok) {
                                throw new Error(`HTTP error! status: ${response.status}`);
                            }

                            const responseData = await response.text();
                            return proxy.url.includes('allorigins.win') ? JSON.parse(responseData).contents : responseData;
                        } catch (error) {
                            clearTimeout(timeoutId);
                            throw error;
                        }
                    };

                    data = await fetchData();
                    console.log("Proxy fonctionnel trouvé:", proxy.url);
                    break;
                } catch (e) {
                    console.log("Échec du proxy:", proxy.url, e);
                    proxyError = e;
                    continue;
                }
            }

            if (!data) {
                throw new Error('Tous les proxys ont échoué: ' + proxyError?.message);
            }

            updateLoadingMessage("Analyse des données...");
            let parser = new DOMParser();
            let doc = parser.parseFromString(data, 'text/html');
            
            // Récupération du titre
            const titleElement = doc.querySelector('h1.entry-title, h1[itemprop="name"]');
            if (titleElement) {
                result.title = titleElement.textContent.trim();
                console.log("Titre trouvé:", result.title);
            }
            
            // Récupération de l'image de couverture
            const imageElement = doc.querySelector('div.summary_image img, img.wp-post-image');
            if (imageElement) {
                const src = imageElement.getAttribute('src');
                // Vérification si l'image est une URL complète
                if (src && src.startsWith('http')) {
                    result.cover = src;
                    console.log("Image trouvée:", result.cover);
                }
            }
            
            // Récupération du dernier chapitre
            const chapterElements = doc.querySelectorAll('li.wp-manga-chapter a, .chapternum');
            if (chapterElements.length > 0) {
                let maxChapter = 0;
                chapterElements.forEach(element => {
                    const text = element.textContent.trim();
                    // Essayer différents formats de numéros de chapitres
                    const matches = [
                        /chapitre\s+(\d+(?:\.\d+)?)\s*/i,
                        /\d+(?:\.\d+)?\s*$/
                    ];
                    
                    for (const regex of matches) {
                        const match = text.match(regex);
                        if (match) {
                            const chapterNumber = parseFloat(match[1]);
                            if (!isNaN(chapterNumber) && chapterNumber > maxChapter) {
                                maxChapter = chapterNumber;
                            }
                            break;
                        }
                    }
                });
                
                if (maxChapter > 0) {
                    result.totalChapters = maxChapter;
                    document.getElementById('chaptersInput').value = maxChapter;
                    console.log("Nombre de chapitres trouvé:", maxChapter);
                }
            }
            
            // Vérification des informations manquantes
            let missingInfo = [];
            if (!result.title) missingInfo.push("titre");
            if (!result.cover) missingInfo.push("couverture");
            if (!result.totalChapters) missingInfo.push("nombre de chapitres");
            
            if (missingInfo.length > 0) {
                showAlert("Impossible de récupérer : " + missingInfo.join(', '));
            }
        } else {
            // Pour les autres sites, récupération rapide du titre depuis l'URL
            let urlParts = url.split('/');
            let lastPart = urlParts[urlParts.length - 1];
            if (lastPart) {
                let title = lastPart
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, letter => letter.toUpperCase());
                if (title) {
                    result.title = title;
                    console.log("Titre depuis URL :", title);
                }
            }
        }
        
        console.log("Résultat final :", result);
        hideLoading();
        return result;
        
    } catch (error) {
        console.error("Erreur générale :", error);
        showAlert("Erreur lors de la récupération des données. Veuillez réessayer ou remplir manuellement.");
        
        // Tentative de récupération du titre depuis l'URL
        try {
            let urlObject = new URL(url);
            let pathParts = urlObject.pathname.split('/');
            
            for (let i = 0; i < pathParts.length; i++) {
                if (pathParts[i] === 'manga' && pathParts[i + 1]) {
                    let titleFromUrl = pathParts[i + 1]
                        .replace(/-/g, ' ')
                        .replace(/\b\w/g, letter => letter.toUpperCase());
                    if (titleFromUrl) {
                        result.title = titleFromUrl;
                        console.log("Titre récupéré depuis l'URL :", titleFromUrl);
                        break;
                    }
                }
            }
        } catch (urlError) {
            console.error("Impossible de récupérer le titre depuis l'URL :", urlError);
        }
        
        hideLoading();
        return result;
    }
}

// Fonction pour afficher l'alerte
function showAlert(message) {
    // Créer l'élément d'alerte
    let alertBox = document.createElement('div');
    alertBox.style.position = 'fixed';
    alertBox.style.top = '20px';
    alertBox.style.left = '50%';
    alertBox.style.transform = 'translateX(-50%)';
    alertBox.style.backgroundColor = '#ff6b6b';
    alertBox.style.color = 'white';
    alertBox.style.padding = '15px 20px';
    alertBox.style.borderRadius = '5px';
    alertBox.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    alertBox.style.zIndex = '10000';
    alertBox.style.maxWidth = '90%';
    alertBox.style.textAlign = 'center';
    alertBox.style.fontFamily = 'Arial, sans-serif';
    
    // alerte
    alertBox.innerHTML = `
        <div>
            <strong>⚠️ Attention</strong><br>
            ${message}<br>
            Veuillez compléter les informations manuellement.
            <br><br>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: white; color: #ff6b6b; border: none; padding: 8px 16px; 
                           border-radius: 4px; cursor: pointer; font-weight: bold;">
                Fermer
            </button>
        </div>
    `;
    
    // Ajout sur la page
    document.body.appendChild(alertBox);
    
    // Supprimer automatiquement apres 5s
    setTimeout(function() {
        if (document.body.contains(alertBox)) {
            alertBox.remove();
        }
    }, 5000);
}


// Opérations CRUD
function openAddModal() {
    currentManhwaId = null;
    $('modalTitle').textContent = 'Ajouter un manhwa';
    $('manhwaForm').reset();
    openModal('editModal');
}

function editManhwa(id) {
    const manhwa = manhwaLibrary.find(m => m.id === id);
    if (!manhwa) return;
    
    currentManhwaId = id;
    $('modalTitle').textContent = 'Modifier le manhwa';
    $('titleInput').value = manhwa.title;
    $('coverInput').value = manhwa.cover || '';
    $('readUrlInput').value = manhwa.readUrl || '';
    $('chaptersInput').value = manhwa.totalChapters;
    
    openModal('editModal');
}

function openDeleteModal(id) {
    currentManhwaId = id;
    openModal('deleteModal');
}

function confirmDelete() {
    if (currentManhwaId === null) return;
    
    manhwaLibrary = manhwaLibrary.filter(m => m.id !== currentManhwaId);
    saveLibrary();
    renderLibrary();
    closeModal('deleteModal');
    currentManhwaId = null;
}

function confirmResetProgress() {
    const manhwa = manhwaLibrary.find(m => m.id === currentManhwaId);
    if (!manhwa) return;
    
    manhwa.readChapters = new Set();
    saveLibrary();
    renderLibrary();
    
    $('chaptersGrid').querySelectorAll('.chapter-item').forEach(item => {
        item.classList.remove('read');
    });
    
    closeModal('resetProgressModal');
}

function handleManhwaFormSubmit(event) {
    event.preventDefault();

    const title = $('titleInput').value.trim();
    const cover = $('coverInput').value.trim();
    const readUrl = $('readUrlInput').value.trim();
    const totalChapters = parseInt($('chaptersInput').value) || 0;

    if (!title || totalChapters <= 0) {
        alert("Veuillez remplir tous les champs correctement.");
        return;
    }

    if (currentManhwaId) {
        // Mode édition
        const index = manhwaLibrary.findIndex(m => m.id === currentManhwaId);
        if (index !== -1) {
            const existingReadChapters = manhwaLibrary[index].readChapters;
            const newReadChapters = new Set(
                [...existingReadChapters].filter(ch => ch <= totalChapters)
            );
            
            const isFavorite = manhwaLibrary[index].isFavorite || false;
            const isDropped = manhwaLibrary[index].isDropped || false;

            manhwaLibrary[index] = {
                id: currentManhwaId,
                title,
                cover,
                readUrl,
                totalChapters,
                readChapters: newReadChapters,
                isFavorite,
                isDropped
            };
        }
    } else {
        // Mode ajout
        manhwaLibrary.push({
            id: Date.now(),
            title,
            cover,
            readUrl,
            totalChapters,
            readChapters: new Set(),
            isFavorite: false,
            isDropped: false
        });
    }

    saveLibrary();
    renderLibrary();
    closeModal('editModal');
}

// Navigation et UI
function switchTab(tab) {
    if (!tab || (tab !== 'all' && tab !== 'completed' && tab !== 'dropped' && tab !== 'favorites')) return;
    
    currentTab = tab;
    
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    
    renderLibrary();
}

function updateVersionDisplay() {
    const versionElement = $('app-version');
    if (versionElement) {
        versionElement.textContent = APP_VERSION;
    }
}

// UI mobile
function enableMobileMode() {
    document.body.classList.add('mobile-mode');
    adjustUIForMobile();
}

function adjustUIForMobile() {
    const library = document.querySelector('.library');
    if (library) {
        library.style.gridTemplateColumns = 'repeat(auto-fill, minmax(130px, 1fr))';
    }
    
    document.querySelectorAll('.edit-buttons').forEach(btn => {
        btn.style.opacity = '1';
    });
    
    document.querySelectorAll('.modal-content').forEach(modal => {
        modal.style.width = '90%';
    });
}

function handleResize() {
    if (isMobileDevice()) {
        enableMobileMode();
    } else {
        document.body.classList.remove('mobile-mode');
        resetUIForDesktop();
    }
}

function resetUIForDesktop() {
    const library = document.querySelector('.library');
    if (library) library.style.gridTemplateColumns = '';
    
    document.querySelectorAll('.edit-buttons').forEach(btn => {
        btn.style.opacity = '';
    });
    
    document.querySelectorAll('.modal-content').forEach(modal => {
        modal.style.width = '';
    });
}

function showSwipeAnimation(direction) {
    const library = document.querySelector('.library');
    library.style.opacity = '0.6';
    
    setTimeout(() => {
        library.style.opacity = '1';
    }, 300);
    
    const swipeIndicator = document.createElement('div');
    swipeIndicator.className = 'swipe-indicator';
    swipeIndicator.textContent = direction === 'left' ? '→ Terminés' : '← En cours';
    document.body.appendChild(swipeIndicator);
    
    setTimeout(() => {
        document.body.removeChild(swipeIndicator);
    }, 800);
}

// Intégration Discord
async function sendDiscordNotification(version, updateInfo) {
    const webhookUrl = "https://discord.com/api/webhooks/1353243772388905070/1S7zjS96Nc57HWtgJ-Jn3MiFUXkp9urwZDwsXNb71Wnz_Oya9ZgE7Ztu4jVr9An5IYbz";
    
    try {
        // Récupérer et nettoyer l'historique des notifications
        const notificationHistory = await cleanNotificationHistory();
        const now = Date.now();
        
        // Vérifier les limites de notifications
        const todayNotifications = Object.values(notificationHistory).filter(
            timestamp => now - timestamp < 24 * 60 * 60 * 1000
        ).length;
        
        if (todayNotifications >= MAX_NOTIFICATIONS_PER_DAY) {
            console.log(`Limite de notifications quotidiennes atteinte (${MAX_NOTIFICATIONS_PER_DAY})`);
            return;
        }
        
        // Vérifier le cooldown pour cette version
        if (notificationHistory[version]) {
            const lastNotificationTime = notificationHistory[version];
            const cooldownRemaining = NOTIFICATION_COOLDOWN - (now - lastNotificationTime);
            
            if (cooldownRemaining > 0) {
                const hoursRemaining = Math.ceil(cooldownRemaining / (1000 * 60 * 60));
                console.log(`Notification pour la version ${version} en cooldown. Prochaine notification possible dans ${hoursRemaining} heures`);
                return;
            }
        }
        
        // Préparer les données de la notification
        const notificationData = await prepareNotificationData(version, updateInfo);
        
        // Envoyer la notification avec retry
        await retryOperation(async () => {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(notificationData)
            });
            
            if (!response.ok) {
                throw new Error(`Erreur Discord: ${response.statusText} (${response.status})`);
            }
            
            return response;
        });
        
        // Mettre à jour l'historique des notifications
        notificationHistory[version] = now;
        await saveNotificationHistory(notificationHistory);
        
        console.log(`✅ Notification Discord envoyée avec succès pour la version ${version}`);
        
    } catch (error) {
        console.error("❌ Erreur lors de l'envoi de la notification Discord:", error);
        showNotificationError(error);
    }
}

// Fonction pour nettoyer l'historique des notifications
async function cleanNotificationHistory() {
    try {
        const history = JSON.parse(localStorage.getItem(DISCORD_NOTIFICATION_HISTORY_KEY) || '{}');
        const now = Date.now();
        
        // Supprimer les entrées plus anciennes que 30 jours
        Object.keys(history).forEach(key => {
            if (now - history[key] > 30 * 24 * 60 * 60 * 1000) {
                delete history[key];
            }
        });
        
        return history;
    } catch (error) {
        console.error("Erreur lors du nettoyage de l'historique:", error);
        return {};
    }
}

// Fonction pour sauvegarder l'historique des notifications
async function saveNotificationHistory(history) {
    try {
        localStorage.setItem(DISCORD_NOTIFICATION_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
        console.error("Erreur lors de la sauvegarde de l'historique:", error);
    }
}

// Fonction pour préparer les données de la notification avec plus d'informations
async function prepareNotificationData(version, updateInfo) {
    const stats = await loadDiscordStats();
    const now = new Date();
    
    // Mettre à jour les statistiques
    stats.totalVisits++;
    stats.uniqueUsers.add(getUserIdentifier());
    stats.lastUpdate = now.toISOString();
    stats.updateHistory.push({
        version,
        date: now.toISOString(),
        type: getUpdateType(updateInfo)
    });
    
    // Limiter l'historique à 10 mises à jour
    if (stats.updateHistory.length > 10) {
        stats.updateHistory = stats.updateHistory.slice(-10);
    }
    
    // Vérifier la santé du système
    const healthStatus = await checkSystemHealth();
    
    // Formater les nouveautés avec des emojis et catégories
    const features = categorizeAndFormatFeatures(updateInfo.features);
    
    // Calculer les statistiques d'utilisation
    const usageStats = calculateUsageStats(stats);
    
    return {
        embeds: [{
            title: `🚀 Mise à jour IXWHA v${version}`,
            description: getUpdateDescription(version, updateInfo),
            color: getColorForUpdate(updateInfo),
            fields: [
                {
                    name: "📦 Version",
                    value: version,
                    inline: true
                },
                {
                    name: "📅 Date",
                    value: formatDate(updateInfo.date),
                    inline: true
                },
                {
                    name: "🔄 Type de mise à jour",
                    value: getUpdateType(updateInfo),
                    inline: true
                },
                ...features,
                {
                    name: "📊 Statistiques",
                    value: formatStats(usageStats),
                    inline: false
                },
                {
                    name: "🏥 État du système",
                    value: formatHealthStatus(healthStatus),
                    inline: false
                }
            ],
            footer: {
                text: `IXWHA - ${stats.uniqueUsers.size} utilisateurs uniques`
            },
            timestamp: now.toISOString()
        }]
    };
}

// Fonction pour catégoriser et formater les fonctionnalités
function categorizeAndFormatFeatures(features) {
    const categories = {
        "✨ Nouvelles fonctionnalités": [],
        "🐛 Corrections": [],
        "⚡ Améliorations": [],
        "🗑️ Suppressions": [],
        "📝 Autres": []
    };
    
    features.forEach(feature => {
        if (feature.toLowerCase().includes('ajout')) {
            categories["✨ Nouvelles fonctionnalités"].push(feature);
        } else if (feature.toLowerCase().includes('correction')) {
            categories["🐛 Corrections"].push(feature);
        } else if (feature.toLowerCase().includes('amélioration')) {
            categories["⚡ Améliorations"].push(feature);
        } else if (feature.toLowerCase().includes('suppression')) {
            categories["🗑️ Suppressions"].push(feature);
        } else {
            categories["📝 Autres"].push(feature);
        }
    });
    
    return Object.entries(categories)
        .filter(([_, items]) => items.length > 0)
        .map(([category, items]) => ({
            name: category,
            value: items.map(item => `• ${item}`).join('\n'),
            inline: false
        }));
}

// Fonction pour obtenir la description de la mise à jour
function getUpdateDescription(version, updateInfo) {
    const type = getUpdateType(updateInfo);
    const descriptions = {
        'majeure': '🎉 Une mise à jour majeure est disponible avec de nouvelles fonctionnalités importantes !',
        'mineure': '📈 Une mise à jour mineure est disponible avec des améliorations !',
        'patch': '🔧 Un patch correctif est disponible !'
    };
    return descriptions[type] || '🚀 Une nouvelle version est disponible !';
}

// Fonction pour déterminer le type de mise à jour
function getUpdateType(updateInfo) {
    const features = updateInfo.features.join(' ').toLowerCase();
    if (features.includes('refonte') || features.includes('majeur')) return 'majeure';
    if (features.includes('ajout') || features.includes('nouvelle')) return 'mineure';
    return 'patch';
}

// Fonction pour obtenir la couleur selon le type de mise à jour
function getColorForUpdate(updateInfo) {
    const colors = {
        'majeure': 15844367, // Orange
        'mineure': 3447003,  // Bleu
        'patch': 5763719     // Vert
    };
    return colors[getUpdateType(updateInfo)] || 3447003;
}

// Fonction pour formater la date
function formatDate(date) {
    const options = { day: 'numeric', month: 'long', year: 'numeric' };
    return new Date(date).toLocaleDateString('fr-FR', options);
}

// Fonction pour calculer les statistiques d'utilisation
function calculateUsageStats(stats) {
    return {
        totalVisits: stats.totalVisits,
        uniqueUsers: stats.uniqueUsers.size,
        updatesLast30Days: stats.updateHistory.filter(
            update => new Date() - new Date(update.date) < 30 * 24 * 60 * 60 * 1000
        ).length
    };
}

// Fonction pour formater les statistiques
function formatStats(stats) {
    return [
        `👥 ${stats.uniqueUsers} utilisateurs uniques`,
        `👀 ${stats.totalVisits} visites totales`,
        `🔄 ${stats.updatesLast30Days} mises à jour (30 derniers jours)`
    ].join('\n');
}

// Fonction pour vérifier la santé du système
async function checkSystemHealth() {
    const lastCheck = localStorage.getItem(DISCORD_LAST_HEALTH_CHECK);
    const now = Date.now();
    
    if (!lastCheck || now - parseInt(lastCheck) > HEALTH_CHECK_INTERVAL) {
        const health = {
            localStorage: checkLocalStorage(),
            performance: await checkPerformance(),
            errors: getRecentErrors()
        };
        
        localStorage.setItem(DISCORD_LAST_HEALTH_CHECK, now.toString());
        return health;
    }
    
    return JSON.parse(localStorage.getItem('systemHealth') || '{"status": "operational"}');
}

// Fonction pour formater l'état du système
function formatHealthStatus(health) {
    const status = health.status === 'operational' ? '✅ Opérationnel' : '⚠️ Problèmes détectés';
    let message = `État: ${status}\n`;
    
    if (health.errors && health.errors.length > 0) {
        message += '\nDernières erreurs:\n' + health.errors.slice(0, 3).join('\n');
    }
    
    return message;
}

// Fonction pour obtenir un identifiant utilisateur unique
function getUserIdentifier() {
    let userId = localStorage.getItem('userId');
    if (!userId) {
        userId = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('userId', userId);
    }
    return userId;
}

// Fonction pour charger les statistiques Discord
async function loadDiscordStats() {
    try {
        const savedStats = localStorage.getItem(DISCORD_STATS_KEY);
        if (savedStats) {
            const stats = JSON.parse(savedStats);
            stats.uniqueUsers = new Set(Array.from(stats.uniqueUsers));
            return stats;
        }
    } catch (error) {
        console.error("Erreur lors du chargement des statistiques Discord:", error);
    }
    return { ...defaultStats, uniqueUsers: new Set() };
}

// Fonction pour sauvegarder les statistiques Discord
async function saveDiscordStats(stats) {
    try {
        const statsToSave = {
            ...stats,
            uniqueUsers: Array.from(stats.uniqueUsers)
        };
        localStorage.setItem(DISCORD_STATS_KEY, JSON.stringify(statsToSave));
    } catch (error) {
        console.error("Erreur lors de la sauvegarde des statistiques Discord:", error);
    }
}

// Fonction pour vérifier le localStorage
function checkLocalStorage() {
    try {
        const testKey = '_test_' + Date.now();
        localStorage.setItem(testKey, 'test');
        localStorage.removeItem(testKey);
        return true;
    } catch {
        return false;
    }
}

// Fonction pour vérifier les performances
async function checkPerformance() {
    const start = performance.now();
    await delay(100);
    return performance.now() - start < 150;
}

// Fonction pour récupérer les erreurs récentes
function getRecentErrors() {
    try {
        const errors = JSON.parse(localStorage.getItem('recentErrors') || '[]');
        return errors.slice(-3);
    } catch {
        return [];
    }
}

// Fonction pour afficher les erreurs de notification
function showNotificationError(error) {
    const notification = {
        title: "Erreur de notification",
        message: `Une erreur est survenue lors de l'envoi de la notification : ${error.message}`,
        type: "error"
    };
    
    // Ajouter la notification à la liste des notifications actives
    activeNotifications.push(notification);
    showNotifications();
}

// Fonction pour charger les notifications depuis le localStorage
function loadNotifications() {
    const storedNotifications = localStorage.getItem(NOTIFICATIONS_KEY);
    if (!storedNotifications) return [];

    try {
        const allNotifications = JSON.parse(storedNotifications);
        // Ne garder que les notifications actives
        return allNotifications.filter(notification => notification.active);
    } catch (error) {
        console.error("Erreur lors du chargement des notifications:", error);
        return [];
    }
}

// Fonction pour afficher les notifications
function showNotifications() {
    if (!settings.notificationsEnabled) return;
    
    activeNotifications = loadNotifications();
    
    if (activeNotifications.length === 0) return;
    
    // Créer le conteneur de notifications s'il n'existe pas déjà
    let notificationContainer = document.getElementById('notification-container');
    
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.id = 'notification-container';
        document.body.appendChild(notificationContainer);
    } else {
        notificationContainer.innerHTML = '';
    }
    
    // Afficher chaque notification active
    activeNotifications.forEach(notification => {
        const notificationElement = document.createElement('div');
        notificationElement.className = `site-notification ${notification.type}`;
        
        notificationElement.innerHTML = `
            <div class="notification-header">
                <div class="notification-title">${notification.title}</div>
                <button class="notification-close">&times;</button>
            </div>
            <div class="notification-body">
                <p>${notification.message}</p>
            </div>
        `;
        
        // Fermer la notification
        notificationElement.querySelector('.notification-close').addEventListener('click', () => {
            notificationElement.classList.add('closing');
            setTimeout(() => {
                notificationElement.remove();
            }, 300);
        });
        
        notificationContainer.appendChild(notificationElement);
    });
}

// Ajouter aux styles CSS existants (à insérer dans styles.css)
function addNotificationStyles() {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        #notification-container {
            position: fixed;
            top: 100px;
            right: 20px;
            z-index: 1000;
            width: 300px;
            max-width: 80vw;
        }
        
        .site-notification {
            background-color: #131215;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            margin-bottom: 12px;
            overflow: hidden;
            animation: slide-in 0.3s ease-out forwards;
            border-left: 4px solid #2196F3;
        }
        
        .site-notification.closing {
            animation: slide-out 0.3s ease-in forwards;
        }
        
        .site-notification.important {
            border-left-color: #b00020;
        }
        
        .site-notification.warning {
            border-left-color: #FFC107;
        }
        
        .site-notification.success {
            border-left-color: #4CAF50;
        }
        
        .notification-header {
            padding: 12px 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #eee;
        }
        
        .notification-title {
            font-weight: 600;
            font-size: 16px;
        }
        
        .notification-close {
            background: none;
            border: none;
            font-size: 20px;
            cursor: pointer;
            color: #757575;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
        }
        
        .notification-close:hover {
            background-color: rgba(0,0,0,0.05);
        }
        
        .notification-body {
            padding: 12px 16px;
        }
        
        @keyframes slide-in {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slide-out {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
    `;
    
    document.head.appendChild(styleElement);
}

// Initialiser le système de notifications
function initNotificationSystem() {
    addNotificationStyles();
    showNotifications();
    
    // Vérifier les nouvelles notifications toutes les 5 minutes
    setInterval(showNotifications, 5 * 60 * 1000);
}

// Fonction pour afficher le résumé des changements
function showUpdateSummary(updates) {
    const summaryModal = document.getElementById('summaryModal');
    if (!summaryModal) {
        console.error('Modal de résumé non trouvé');
        return;
    }

    const summaryText = document.getElementById('summaryText');
    const updateList = document.getElementById('updateList');
    
    if (!summaryText || !updateList) {
        console.error('Éléments du modal de résumé non trouvés');
        return;
    }
    
    if (updates.length === 0) {
        summaryText.textContent = "Aucun nouveau chapitre n'a été trouvé.";
        updateList.innerHTML = '';
    } else {
        summaryText.textContent = `${updates.length} manhwa(s) mis à jour :`;
        updateList.innerHTML = updates.map(update => `
            <li>
                <span class="manhwa-title">${update.title}</span>
                <span class="chapter-update">
                    ${update.oldChapters} → ${update.newChapters} chapitres
                    <span class="new-chapters">(+${update.newChapters - update.oldChapters})</span>
                </span>
            </li>
        `).join('');
    }
    
    summaryModal.style.display = 'block';
}

// Fonction pour vérifier les nouveaux chapitres
async function checkNewChapters() {
    if (!settings.autoCheckEnabled) return [];
    
    console.log('🔍 Début de la vérification des nouveaux chapitres...');
    const lastCheck = localStorage.getItem(LAST_CHECK_KEY);
    const now = Date.now();
    
    // Afficher l'indicateur de chargement
    showLoading("Vérification des nouveaux chapitres...");
    
    // Vérifier si une semaine s'est écoulée depuis la dernière vérification
    if (lastCheck && (now - parseInt(lastCheck)) < CHECK_INTERVAL) {
        console.log('⏳ La dernière vérification date de moins d\'une semaine, passage...');
        hideLoading();
        return [];
    }

    try {
        const phenixManhwas = manhwaLibrary.filter(m => m.readUrl.includes('phenix-scans.com'));
        console.log(`📚 ${phenixManhwas.length} manhwas Phenix Scans trouvés`);
        
        const updates = []; // Pour stocker les mises à jour

        for (const manhwa of phenixManhwas) {
            try {
                console.log(`\n🔎 Vérification de "${manhwa.title}"...`);
                updateLoadingMessage(`Vérification de "${manhwa.title}"...`);
                
                // Extraire l'URL de base du manhwa
                const urlObj = new URL(manhwa.readUrl);
                const pathParts = urlObj.pathname.split('/').filter(Boolean);
                if (pathParts.length < 2 || pathParts[0] !== 'manga') {
                    console.log('❌ URL invalide pour ce manhwa');
                    continue;
                }

                const manhwaName = pathParts[1];
                const checkUrl = `https://phenix-scans.com/manga/${manhwaName}/`;
                
                // Liste des proxys à essayer
                const proxyUrls = [
                    `https://corsproxy.io/?${encodeURIComponent(checkUrl)}`,
                    `https://api.allorigins.win/get?url=${encodeURIComponent(checkUrl)}`,
                    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(checkUrl)}`
                ];

                let data = null;
                let proxyError = null;

                // Essayer chaque proxy
                for (const proxyUrl of proxyUrls) {
                    try {
                        console.log(`🔄 Tentative avec le proxy: ${proxyUrl}`);
                        
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 10000);

                        const response = await fetch(proxyUrl, {
                            headers: {
                                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                                'Accept-Language': 'fr,fr-FR;q=0.8,en-US;q=0.5,en;q=0.3',
                            },
                            signal: controller.signal
                        });

                        clearTimeout(timeoutId);

                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }

                        const responseData = await response.text();
                        data = proxyUrl.includes('allorigins.win') ? JSON.parse(responseData).contents : responseData;
                        console.log('✅ Proxy fonctionnel trouvé');
                        break;
                    } catch (e) {
                        console.log('❌ Échec du proxy:', e);
                        proxyError = e;
                        continue;
                    }
                }

                if (!data) {
                    throw new Error('Tous les proxys ont échoué: ' + proxyError?.message);
                }

                // Analyser le contenu
                const parser = new DOMParser();
                const doc = parser.parseFromString(data, 'text/html');
                
                // Trouver le dernier chapitre
                const chapterElements = doc.querySelectorAll('.project__chapter-heading-title');
                if (chapterElements.length > 0) {
                    const lastChapterText = chapterElements[0].textContent.trim();
                    const match = lastChapterText.match(/\d+/);
                    if (match) {
                        const lastChapter = parseInt(match[0], 10);
                        console.log(`📖 Dernier chapitre trouvé: ${lastChapter}`);
                        
                        if (lastChapter > manhwa.totalChapters) {
                            console.log(`✨ Nouveaux chapitres détectés! (${manhwa.totalChapters} -> ${lastChapter})`);
                            updates.push({
                                title: manhwa.title,
                                oldChapters: manhwa.totalChapters,
                                newChapters: lastChapter
                            });
                            manhwa.totalChapters = lastChapter;
                        } else {
                            console.log('ℹ️ Pas de nouveaux chapitres');
                        }
                    }
                }

            } catch (error) {
                console.error(`❌ Erreur lors de la vérification de "${manhwa.title}":`, error);
            }
        }

        // Sauvegarder les modifications
        saveLibrary();
        // Mettre à jour la date de dernière vérification
        localStorage.setItem(LAST_CHECK_KEY, now.toString());
        console.log('✅ Vérification terminée');
        
        // Cacher l'indicateur de chargement
        hideLoading();
        
        // Afficher le résumé des changements
        showUpdateSummary(updates);

        // Retourner les mises à jour pour la Promise
        return updates;
    } catch (error) {
        console.error('❌ Erreur générale lors de la vérification:', error);
        hideLoading();
        throw error;
    }
}

// Fonction pour forcer une vérification manuelle
async function forceCheckNewChapters() {
    console.log('🔄 Forçage de la vérification des nouveaux chapitres...');
    localStorage.removeItem(LAST_CHECK_KEY);
    return checkNewChapters();
}

// Fonctions de gestion des paramètres
function loadSettings() {
    const savedSettings = localStorage.getItem(SETTINGS_KEY);
    if (savedSettings) {
        try {
            settings = JSON.parse(savedSettings);
        } catch (error) {
            console.error("Erreur lors du chargement des paramètres:", error);
            settings = {
                refreshButtonEnabled: true,
                autoCheckEnabled: true,
                notificationsEnabled: true,
                darkModeEnabled: false,
                compactModeEnabled: false,
                animationsEnabled: true,
                cardSize: 'medium',
                defaultSort: 'title'
            };
        }
    }
    
    // Mettre à jour les contrôles
    $('refreshButtonToggle').checked = settings.refreshButtonEnabled;
    $('autoCheckToggle').checked = settings.autoCheckEnabled;
    $('notificationsToggle').checked = settings.notificationsEnabled;
    $('darkModeToggle').checked = settings.darkModeEnabled;
    $('compactModeToggle').checked = settings.compactModeEnabled;
    $('animationsToggle').checked = settings.animationsEnabled;
    $('cardSizeSelect').value = settings.cardSize;
    $('defaultSortSelect').value = settings.defaultSort;
    
    // Appliquer les paramètres
    applySettings();
}

function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function updateSetting(key, value) {
    settings[key] = value;
    saveSettings();
    applySettings();
    
    // Appliquer des changements spécifiques immédiatement
    switch(key) {
        case 'darkModeEnabled':
            document.body.classList.toggle('dark-mode', value);
            break;
        case 'compactModeEnabled':
            document.body.classList.toggle('compact-mode', value);
            break;
        case 'animationsEnabled':
            document.body.classList.toggle('no-animations', !value);
            break;
        case 'cardSize':
            document.body.classList.remove('card-size-small', 'card-size-medium', 'card-size-large');
            document.body.classList.add(`card-size-${value}`);
            break;
        case 'refreshButtonEnabled':
            $('refreshButton').style.display = value ? 'flex' : 'none';
            break;
    }
}

function applySettings() {
    // Bouton d'actualisation
    $('refreshButton').style.display = settings.refreshButtonEnabled ? 'flex' : 'none';
    
    // Mode sombre
    document.body.classList.toggle('dark-mode', settings.darkModeEnabled);
    
    // Mode compact
    document.body.classList.toggle('compact-mode', settings.compactModeEnabled);
    
    // Animations
    document.body.classList.toggle('no-animations', !settings.animationsEnabled);
    
    // Taille des cartes
    document.body.classList.remove('card-size-small', 'card-size-medium', 'card-size-large');
    document.body.classList.add(`card-size-${settings.cardSize}`);
    
    // Tri par défaut
    if (currentTab === 'all') {
        sortLibrary(settings.defaultSort);
    }
}

function sortLibrary(sortBy) {
    switch (sortBy) {
        case 'title':
            manhwaLibrary.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case 'lastRead':
            manhwaLibrary.sort((a, b) => {
                const aLastRead = Math.max(...Array.from(a.readChapters), 0);
                const bLastRead = Math.max(...Array.from(b.readChapters), 0);
                return bLastRead - aLastRead;
            });
            break;
        case 'progress':
            manhwaLibrary.sort((a, b) => {
                const aProgress = a.totalChapters > 0 ? a.readChapters.size / a.totalChapters : 0;
                const bProgress = b.totalChapters > 0 ? b.readChapters.size / b.totalChapters : 0;
                return bProgress - aProgress;
            });
            break;
    }
    renderLibrary();
}

// Fonction pour gérer le scroll
function handleScroll() {
    if (!isMobileDevice()) return;

    const header = document.querySelector('.header');
    const currentScroll = window.pageYOffset || document.documentElement.scrollTop;

    // Déterminer la direction du scroll
    if (currentScroll > lastScrollTop && currentScroll > 100) {
        // Scroll vers le bas
        header.classList.remove('visible');
        header.classList.add('hidden');
    } else {
        // Scroll vers le haut
        header.classList.remove('hidden');
        header.classList.add('visible');
    }

    lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;

    // Réinitialiser le timeout
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
        if (currentScroll <= 100) {
            header.classList.remove('hidden');
            header.classList.add('visible');
        }
    }, 150);
}

// Ajouter l'écouteur d'événement de scroll
window.addEventListener('scroll', handleScroll, { passive: true });

// Fonction utilitaire pour le délai avec retry
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Fonction utilitaire pour les retries
async function retryOperation(operation, maxRetries = MAX_RETRIES, retryDelay = RETRY_DELAY) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.log(`Tentative ${i + 1}/${maxRetries} échouée:`, error);
            if (i < maxRetries - 1) {
                await delay(retryDelay * Math.pow(2, i)); // Délai exponentiel
            }
        }
    }
    
    throw lastError;
}

function buildReadUrl(baseUrl, chapterNumber) {
    if (!baseUrl) return '#';
    
    try {
        // Cas spécial Phenix Scans
        if (baseUrl.includes('phenix-scans.com')) {
            const urlObj = new URL(baseUrl);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            
            if (pathParts.length >= 2 && pathParts[0] === 'manga') {
                const manhwaName = pathParts[1];
                return `https://phenix-scans.com/manga/${manhwaName}/chapitre/${chapterNumber}`;
            }
        } else if (baseUrl.includes('rimuscans.fr')) {
            const urlObj = new URL(baseUrl);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            
            if (pathParts.length >= 2 && pathParts[0] === 'manga') {
                const manhwaName = pathParts[1];
                // Format spécifique pour Rimuscans : titre-chapitre-XX
                return `https://rimuscans.fr/${manhwaName}-chapitre-${chapterNumber}/`;
            }
        }
        
        // Cas général
        const cleanUrl = baseUrl.replace(/\/+$/, '');
        const urlWithoutManga = cleanUrl.replace('/manga/', '/');
        
        const urlParts = urlWithoutManga.split('/');
        const title = urlParts.pop() || '';
        const urlBase = urlParts.join('/');
        
        return `${urlBase}/${title}-chapitre-${chapterNumber}/`;
    } catch (error) {
        console.error("Erreur lors de la construction de l'URL:", error);
        return baseUrl;
    }
}

function showLoading(message = "Chargement en cours...") {
    // Supprimer l'overlay existant s'il y en a un
    const existingOverlay = document.getElementById('loadingOverlay');
    if (existingOverlay) {
        existingOverlay.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay active';
    overlay.id = 'loadingOverlay';
    
    const container = document.createElement('div');
    container.className = 'loading-container';
    
    const spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    
    const text = document.createElement('div');
    text.className = 'loading-text';
    text.textContent = message;
    
    container.appendChild(spinner);
    container.appendChild(text);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
}

function updateLoadingMessage(message) {
    const text = document.querySelector('.loading-text');
    if (text) {
        text.textContent = message;
    }
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 300);
    }
}
