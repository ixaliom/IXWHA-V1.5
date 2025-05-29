// Constantes et config
const READING_TIME_PER_CHAPTER = 5; // minutes par chapitre

// Chargement initial
document.addEventListener('DOMContentLoaded', () => {
    // Charger les stats
    loadProfileStats();
    
    // Ajouter les event listeners
    setupEventListeners();
});

// Configuration des écouteurs d'événements
function setupEventListeners() {
    // Boutons d'export
    document.getElementById('exportJsonBtn').addEventListener('click', () => exportData('json'));
    
    // Import
    document.getElementById('importBtn').addEventListener('click', () => {
        document.getElementById('importInput').click();
    });
    document.getElementById('importInput').addEventListener('change', importData);
    
    // Danger zone
    document.getElementById('deleteDataBtn').addEventListener('click', () => openModal('deleteDataModal'));
    document.getElementById('resetProgressBtn').addEventListener('click', resetAllProgress);
    
    // Modal
    document.getElementById('confirmDeleteBtn').addEventListener('click', deleteAllData);
    document.getElementById('cancelDeleteBtn').addEventListener('click', () => closeModal('deleteDataModal'));
}

// Charger les statistiques du profil
function loadProfileStats() {
    const manhwaLibrary = getManhwaLibrary();
    
    // Statistiques de base
    const totalManhwas = manhwaLibrary.length;
    const inProgressManhwas = manhwaLibrary.filter(m => 
        getReadChaptersCount(m) < m.totalChapters
    ).length;
    const completedManhwas = manhwaLibrary.filter(m => 
        getReadChaptersCount(m) === m.totalChapters
    ).length;

    // Mettre à jour l'interface
    document.getElementById('totalManhwas').textContent = totalManhwas;
    document.getElementById('inProgressManhwas').textContent = inProgressManhwas;
    document.getElementById('completedManhwas').textContent = completedManhwas;

    // Calculer et afficher les stats de lecture
    calculateReadingStats();
}

// Calculer les statistiques avancées de lecture
function calculateReadingStats() {
    const manhwaLibrary = getManhwaLibrary();
    
    // Temps total de lecture (en minutes)
    const totalReadingTime = manhwaLibrary.reduce((total, manhwa) => 
        total + (getReadChaptersCount(manhwa) * READING_TIME_PER_CHAPTER), 0);
    
    // Progression moyenne en pourcentage
    let averageProgress = 0;
    if (manhwaLibrary.length > 0) {
        const totalProgress = manhwaLibrary.reduce((total, manhwa) => {
            const progress = (getReadChaptersCount(manhwa) / manhwa.totalChapters) * 100;
            return total + progress;
        }, 0);
        averageProgress = (totalProgress / manhwaLibrary.length).toFixed(1);
    }

    // Mettre à jour l'interface
    const hours = Math.round(totalReadingTime / 60);
    document.getElementById('totalReadingTime').textContent = `${hours} heures`;
    document.getElementById('averageProgress').textContent = `${averageProgress}%`;
}

// Obtenir le nombre de chapitres lus pour un manhwa
function getReadChaptersCount(manhwa) {
    return manhwa.readChapters ? Array.from(manhwa.readChapters).length : 0;
}

// Obtenir la bibliothèque depuis le localStorage
function getManhwaLibrary() {
    return JSON.parse(localStorage.getItem('manhwaLibrary')) || [];
}

// Exporter les données
function exportData(format) {
    const manhwaLibrary = getManhwaLibrary();
    
    // Export JSON uniquement
    const exportContent = JSON.stringify(manhwaLibrary, null, 2);
    const mimeType = 'application/json';
    const extension = 'json';
    
    // Créer et déclencher le téléchargement
    downloadFile(exportContent, `ixwha_manhwa_library.${extension}`, mimeType);
}

// Télécharger un fichier
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Importer des données
function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            // Tenter de parser le JSON
            const importedData = JSON.parse(e.target.result);
            
            // Valider le format minimal
            if (!Array.isArray(importedData)) {
                throw new Error("Format invalide: les données doivent être un tableau");
            }
            
            // Sauvegarder et mettre à jour
            localStorage.setItem('manhwaLibrary', JSON.stringify(importedData));
            loadProfileStats();
            showImportSuccessPopup();
        } catch (error) {
            alert(`Erreur d'importation: ${error.message || "Format JSON invalide"}`);
        }
    };
    reader.readAsText(file);
    
    // Réinitialiser l'input file pour permettre de sélectionner le même fichier
    event.target.value = '';
}

// Afficher la notification de succès d'importation
function showImportSuccessPopup() {
    const popup = document.getElementById('importSuccessPopup');
    popup.style.display = 'block';
    
    // Cacher la popup après 3 secondes
    setTimeout(() => {
        popup.style.display = 'none';
    }, 3000);
}

// Réinitialiser la progression de tous les manhwas
function resetAllProgress() {
    if (!confirm('Voulez-vous réinitialiser la progression de TOUS vos manhwas ?')) {
        return;
    }
    
    const manhwaLibrary = getManhwaLibrary();
    
    // Mettre à jour chaque manhwa pour vider les chapitres lus
    const updatedLibrary = manhwaLibrary.map(manhwa => ({
        ...manhwa,
        readChapters: []
    }));
    
    // Sauvegarder et mettre à jour l'interface
    localStorage.setItem('manhwaLibrary', JSON.stringify(updatedLibrary));
    loadProfileStats();
    alert('Progression de tous les manhwas réinitialisée avec succès.');
}

// Supprimer toutes les données
function deleteAllData() {
    // Double confirmation pour cette action destructive
    if (!confirm('Êtes-vous VRAIMENT sûr de vouloir supprimer TOUTES vos données ?')) {
        return;
    }
    
    // Supprimer les données
    localStorage.removeItem('manhwaLibrary');
    localStorage.removeItem('hasVisited');
    
    // Fermer le modal et mettre à jour l'interface
    closeModal('deleteDataModal');
    loadProfileStats();
    alert('Toutes les données ont été supprimées avec succès.');
}

// Gestion des modaux
function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}
