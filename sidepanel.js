import { 
    saveAnnonces, 
    getAllAnnonces, 
    exportDB, 
    deleteAnnonce, 
    saveImage, 
    getImage, 
    clearDatabase, 
    getAnnonceByVintedId,
    getAnnonceBySimilarity,
    updateAnnonce,
    saveAnnonce,
    getAnnonceByLocalId
} from './db.js';

function initializeApp() {
    const extractButton = document.getElementById('extract-button');
    const statusElement = document.getElementById('status');
    const exportButton = document.getElementById('export-button');
    const lastExportElement = document.getElementById('last-export');

    if (extractButton) extractButton.addEventListener('click', extractAnnonces);
    if (exportButton) exportButton.addEventListener('click', exportDatabase);

    const resetDbButton = document.getElementById('reset-db-button');
    if (resetDbButton) resetDbButton.addEventListener('click', resetDatabase);

    const importButton = document.getElementById('import-button');
    if (importButton) importButton.addEventListener('click', importDatabase);

    // Mise à jour des sélecteurs pour la nouvelle structure
    const navButtons = document.querySelectorAll('#nav button');
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const pageId = button.id.replace('-nav', '-page');
            showPage(pageId);
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });

    // Initialisation des autres éléments
    initializeUserIdField();
    displaySavedAnnonces();
}

// Fonction pour afficher une page spécifique
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const pageToShow = document.getElementById(pageId);
    if (pageToShow) pageToShow.classList.add('active');
}

// Attendre que le DOM soit chargé avant d'initialiser l'application
document.addEventListener('DOMContentLoaded', initializeApp);


async function saveUserId(userId) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ userId: userId }, () => {
            resolve();
        });
    });
}

async function loadUserId() {
    return new Promise((resolve) => {
        chrome.storage.local.get('userId', (result) => {
            resolve(result.userId || '');
        });
    });
}

// Appelez cette fonction au chargement de la page
async function initializeUserIdField() {
    const userIdInput = document.getElementById('user-id');
    const savedUserId = await loadUserId();
    userIdInput.value = savedUserId;

    // Ajoutez un écouteur d'événements pour sauvegarder l'ID lorsqu'il change
    userIdInput.addEventListener('change', async () => {
        await saveUserId(userIdInput.value);
    });
}

// Appelez cette fonction au démarrage
document.addEventListener('DOMContentLoaded', async () => {
    await initializeUserIdField();
    await displaySavedAnnonces();
});


async function extractAnnonces() {
    showLoading();
    try {
        setStatus("Récupération du cookie d'authentification...");
        const authCookie = await getAuthCookie();
        if (!authCookie) {
            throw new Error("Erreur d'authentification. Assurez-vous d'être connecté à Vinted.");
        }

        setStatus("Récupération de l'ID utilisateur...");
        const userId = await getUserId();
        if (!userId) {
            throw new Error("Impossible de récupérer l'ID utilisateur.");
        }

        let allAnnonces = [];
        let currentPage = 1;
        let totalPages = 1;

        do {
            setStatus(`Extraction des annonces... Page ${currentPage}`);
            try {
                const url = `https://www.vinted.fr/api/v2/users/${userId}/items?page=${currentPage}&per_page=20&order=relevance`;
                const response = await fetch(url, {
                    headers: {
                        'Cookie': `_vinted_fr_session=${authCookie}`,
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Erreur HTTP: ${response.status}`);
                }

                const data = await response.json();
                allAnnonces = allAnnonces.concat(data.items);
                
                totalPages = data.pagination.total_pages;
                currentPage++;

                setStatus(`Récupérées ${allAnnonces.length} annonces sur ${data.pagination.total_entries}`);
            } catch (error) {
                console.error(`Erreur lors de la récupération de la page ${currentPage}:`, error);
                setStatus(`Erreur lors de la récupération de la page ${currentPage}. Tentative de continuer...`, true);
                currentPage++; // Passer à la page suivante malgré l'erreur
            }
        } while (currentPage <= totalPages);

        setStatus("Traitement des annonces...");
        for (let i = 0; i < allAnnonces.length; i++) {
            try {
                const annonce = allAnnonces[i];
                setStatus(`Traitement de l'annonce ${i + 1} sur ${allAnnonces.length}`);
                
                let existingAnnonce = await getAnnonceByVintedId(annonce.id);
                if (!existingAnnonce) {
                    existingAnnonce = await getAnnonceBySimilarity(annonce.title, annonce.price, annonce.description);
                }

                if (existingAnnonce) {
                    existingAnnonce = {...existingAnnonce, ...annonce};
                    existingAnnonce.updated_at = Date.now();
                    await updateAnnonce(existingAnnonce);
                } else {
                    annonce.localId = generateLocalId();
                    annonce.addedToDBDate = Date.now();
                    annonce.publicationStatus = 'published';
                    annonce.deletionDate = null;
                    if (annonce.created_at_ts && annonce.created_at_ts < 10000000000) {
                        annonce.created_at_ts *= 1000;
                    }
                    await saveAnnonce(annonce);
                }

                await downloadAndSaveImages(annonce, i + 1, allAnnonces.length);
            } catch (error) {
                console.error(`Erreur lors du traitement de l'annonce ${i + 1}:`, error);
                setStatus(`Erreur lors du traitement de l'annonce ${i + 1}. Passage à la suivante...`, true);
            }
        }

        setStatus(`${allAnnonces.length} annonces traitées.`);
        await displaySavedAnnonces();
    } catch (error) {
        console.error("Erreur lors de l'extraction des annonces:", error);
        setStatus(`Erreur: ${error.message}`, true);
    } finally {
        hideLoading();
    }
}


async function downloadAndSaveImages(annonce, annonceIndex, totalAnnonces) {
    for (let i = 0; i < annonce.photos.length; i++) {
        const photo = annonce.photos[i];
        setStatus(`Téléchargement de l'image ${i + 1} sur ${annonce.photos.length} pour l'annonce ${annonceIndex} sur ${totalAnnonces}`);
        try {
            const imageUrl = photo.full_size_url || photo.url;
            const response = await fetch(imageUrl);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const imageBlob = await response.blob();
            await saveImage(annonce.localId, imageBlob, i);
        } catch (error) {
            console.error(`Erreur lors du téléchargement de l'image ${i} pour l'annonce ${annonce.id}:`, error);
        }
    }
}


async function fetchImage(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Erreur HTTP: ${response.status}`);
    }
    return await response.blob();
}

async function getAuthCookie() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({action: "getAuthCookie"}, (response) => {
            resolve(response.cookie);
        });
    });
}

async function getUserId() {
    const userId = await loadUserId();
    if (!userId) {
        throw new Error("ID utilisateur non défini. Veuillez le définir dans les options.");
    }
    return userId;
}



function setStatus(message, isError = false) {
    statusElement.textContent = message;
    statusElement.className = isError ? 'error active' : 'success active';
    console.log(message);
    
    // Cacher le message après 5 secondes
    setTimeout(() => {
        statusElement.className = '';
        statusElement.textContent = '';
    }, 5000);
}

function showLoading() {
    extractButton.disabled = true;
    extractButton.textContent = 'Chargement...';
}

function hideLoading() {
    extractButton.disabled = false;
    extractButton.textContent = 'Extraire les annonces';
}

function createLoadingElement() {
    const loadingElement = document.createElement('div');
    loadingElement.id = 'loading';
    loadingElement.textContent = 'Chargement...';
    loadingElement.style.position = 'fixed';
    loadingElement.style.top = '50%';
    loadingElement.style.left = '50%';
    loadingElement.style.transform = 'translate(-50%, -50%)';
    loadingElement.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    loadingElement.style.color = 'white';
    loadingElement.style.padding = '20px';
    loadingElement.style.borderRadius = '5px';
    loadingElement.style.zIndex = '1000';
    document.body.appendChild(loadingElement);
    return loadingElement;
}

async function displaySavedAnnonces(isDeletedView = false) {
    const annonces = isDeletedView ? await identifyDeletedAnnonces() : await getAllAnnonces();
    const annoncesList = document.getElementById('annonces-list');
    if (!annoncesList) {
        console.error("L'élément 'annonces-list' n'a pas été trouvé dans le DOM");
        return; // Sortir de la fonction si l'élément n'existe pas
    }

    annoncesList.innerHTML = '';
    // Créez un DocumentFragment pour améliorer les performances
    const fragment = document.createDocumentFragment();

    for (const annonce of annonces) {
        const annonceElement = document.createElement('div');
        annonceElement.className = 'annonce-item';
        
        const imageUrl = annonce.photos[0]?.url || 'placeholder.jpg';

        annonceElement.innerHTML = `
        <div class="annonce-image-container">
            <img src="${imageUrl}" class="annonce-thumbnail" alt="${annonce.title}">
            <div class="annonce-stats">
                <span><i class="fas fa-eye"></i> ${annonce.view_count || 0}</span>
                <span><i class="fas fa-heart"></i> ${annonce.favourite_count || 0}</span>
            </div>
        </div>
        <div class="annonce-details">
            <h3>${annonce.title}</h3>
            <p>Prix : ${formatPrice(annonce.price)}</p>
            <p>Publication : ${formatDate(annonce.created_at_ts)}</p>
            <p>Création dans la DB : ${formatDate(annonce.addedToDBDate)}</p>
            <div class="annonce-actions">
                <i class="fas fa-info-circle" title="Voir les détails"></i>
                <i class="fas fa-globe" title="Voir sur Vinted"></i>
                ${isDeletedView ? 
                    `<i class="fas fa-redo" title="Republier"></i>` :
                    `<i class="fas fa-ban" title="Supprimer de Vinted"></i>`
                }
                <i class="fas fa-trash" title="Supprimer de la base de données"></i>
            </div>
        </div>
        `;

        fragment.appendChild(annonceElement);

        // Ajout des écouteurs d'événements
        const actions = annonceElement.querySelector('.annonce-actions');
        if (actions) {
            actions.querySelector('.fa-info-circle').addEventListener('click', () => showAnnonceDetails(annonce));
            actions.querySelector('.fa-globe').addEventListener('click', () => openVintedPage(annonce.url));
            if (isDeletedView) {
                actions.querySelector('.fa-redo').addEventListener('click', () => republishAnnonce(annonce.localId));
            } else {
                actions.querySelector('.fa-ban').addEventListener('click', () => markAsUnpublished(annonce.localId));
            }
            actions.querySelector('.fa-trash').addEventListener('click', () => deleteAnnonceFromDB(annonce.localId));
        }

        // Ajout d'écouteurs pour l'image et le titre
        annonceElement.querySelector('.annonce-thumbnail').addEventListener('click', () => showAnnonceDetails(annonce));
        annonceElement.querySelector('h3').addEventListener('click', () => showAnnonceDetails(annonce));
    }

    // Ajoutez le fragment au DOM une seule fois
    annoncesList.appendChild(fragment);

    updateAnnonceCount(annonces.length, isDeletedView);
}





function formatPrice(price) {
    if (typeof price === 'object' && price.amount && price.currency_code) {
        return `${parseFloat(price.amount).toFixed(2)} ${price.currency_code}`;
    }
    return 'Prix non disponible';
}

function formatDate(timestamp) {
    if (!timestamp) return 'Date non disponible';
    // Convertir en millisecondes si nécessaire
    const ms = typeof timestamp === 'number' && timestamp < 10000000000 
        ? timestamp * 1000 
        : timestamp;
    const date = new Date(ms);
    if (isNaN(date.getTime())) return 'Date invalide';
    return `${date.getDate().toString().padStart(2, '0')}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getFullYear()}`;
}




function updateAnnonceCount(count) {
    annoncesCountElement.textContent = `Nombre d'annonces : ${count}`;
}

function openVintedPage(url) {
    chrome.tabs.create({ url });
}

async function deleteAnnonceFromDB(localId) {
    try {
        await deleteAnnonce(localId);
        setStatus("Annonce supprimée avec succès.");
        await displaySavedAnnonces();
    } catch (error) {
        console.error("Erreur lors de la suppression de l'annonce:", error);
        setStatus(`Erreur: ${error.message}`, true);
    }
}

async function markAsUnpublished(localId) {
    try {
        const annonce = await getAnnonceByLocalId(localId);
        if (!annonce) {
            throw new Error("Annonce non trouvée");
        }

        let vintedDeletionSuccess = false;
        if (annonce.vintedId) {
            try {
                vintedDeletionSuccess = await deleteFromVinted(annonce.vintedId);
            } catch (vintedError) {
                console.error("Erreur lors de la suppression sur Vinted:", vintedError);
                // On continue le processus même si la suppression sur Vinted a échoué
            }
        }

        annonce.publicationStatus = 'unpublished';
        annonce.deletionDate = Date.now();
        if (vintedDeletionSuccess) {
            annonce.vintedId = null; // Supprime l'ID Vinted seulement si la suppression a réussi
        }

        await updateAnnonce(annonce);

        if (vintedDeletionSuccess) {
            setStatus("Annonce marquée comme non publiée et supprimée de Vinted.");
        } else {
            setStatus("Annonce marquée comme non publiée localement, mais la suppression sur Vinted a peut-être échoué.");
        }

        await displaySavedAnnonces();
    } catch (error) {
        console.error("Erreur lors du marquage de l'annonce comme non publiée:", error);
        setStatus(`Erreur: ${error.message}`, true);
    }
}



async function exportDatabase() {
    showLoading();
    try {
        setStatus("Préparation de l'export...");
        const zip = new JSZip();
        const annonces = await getAllAnnonces();
        zip.file("annonces.json", JSON.stringify(annonces));

        for (const annonce of annonces) {
            for (let i = 0; i < annonce.photos.length; i++) {
                const imageBlob = await getImage(annonce.localId, i);
                if (imageBlob) {
                    const extension = imageBlob.type.split('/')[1] || 'jpg';
                    zip.file(`images/${annonce.localId}_${i}.${extension}`, imageBlob);
                }
            }
        }

        const content = await zip.generateAsync({type: "blob"});
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vinted_annonces_export.zip';
        a.click();
        URL.revokeObjectURL(url);

        setStatus("Export réussi. L'archive a été téléchargée.");
        const now = new Date().toLocaleString();
        chrome.storage.local.set({ lastExportDate: now });
        lastExportElement.textContent = `Dernière exportation : ${now}`;
    } catch (error) {
        console.error("Erreur lors de l'export de la base de données:", error);
        setStatus(`Erreur lors de l'export: ${error.message}`, true);
    } finally {
        hideLoading();
    }
}

async function importDatabase() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.zip';

    fileInput.onchange = async (event) => {
        const file = event.target.files[0];
        if (file) {
            showLoading();
            try {
                setStatus("Importation en cours...");
                const zip = await JSZip.loadAsync(file);
                const annoncesJson = await zip.file("annonces.json").async("string");
                const annonces = JSON.parse(annoncesJson);
                await clearDatabase();
                await saveAnnonces(annonces);

                for (const annonce of annonces) {
                    for (let i = 0; i < annonce.photos.length; i++) {
                        const imageFile = zip.file(`images/${annonce.localId}_${i}.jpg`);
                        if (imageFile) {
                            const imageBlob = await imageFile.async("blob");
                            await saveImage(annonce.localId, imageBlob, i);
                        }
                    }
                }

                setStatus("Import réussi. Les données ont été restaurées.");
                await displaySavedAnnonces();
            } catch (error) {
                console.error("Erreur lors de l'import de la base de données:", error);
                setStatus(`Erreur lors de l'import: ${error.message}`, true);
            } finally {
                hideLoading();
            }
        }
    };

    fileInput.click();
}

async function resetDatabase() {
    if (confirm("Êtes-vous sûr de vouloir réinitialiser la base de données ? Toutes les données seront perdues.")) {
        try {
            await clearDatabase();
            setStatus("Base de données réinitialisée avec succès.");
            await displaySavedAnnonces();
        } catch (error) {
            console.error("Erreur lors de la réinitialisation de la base de données:", error);
            setStatus(`Erreur lors de la réinitialisation: ${error.message}`, true);
        }
    }
}

function generateLocalId() {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Initialisation
document.addEventListener('DOMContentLoaded', async () => {
    await displaySavedAnnonces();
    chrome.storage.local.get('lastExportDate', (result) => {
        if (result.lastExportDate) {
            lastExportElement.textContent = `Dernière exportation : ${result.lastExportDate}`;
        }
    });
});

async function showAnnonceDetails(annonce) {
    showPage('annonce-details-page');
    const detailsContent = document.getElementById('annonce-details-content');
    detailsContent.innerHTML = '';

    // Afficher les images
    const imagesContainer = document.createElement('div');
    imagesContainer.className = 'annonce-images';
    for (let i = 0; i < annonce.photos.length; i++) {
        const img = document.createElement('img');
        img.className = 'annonce-image';
        const imageBlob = await getImage(annonce.localId, i);
        img.src = imageBlob ? URL.createObjectURL(imageBlob) : annonce.photos[i].url;
        imagesContainer.appendChild(img);
    }
    detailsContent.appendChild(imagesContainer);

    // Créer des champs éditables pour chaque propriété de l'annonce
    const editableFields = ['title', 'price', 'description', 'size', 'brand'];
    editableFields.forEach(field => {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'editable-field';
        const label = document.createElement('label');
        label.textContent = field.charAt(0).toUpperCase() + field.slice(1);
        const input = field === 'description' ? document.createElement('textarea') : document.createElement('input');
        input.value = field === 'price' ? formatPrice(annonce[field]) : (annonce[field] || '');
        input.addEventListener('change', (e) => updateAnnonceField(annonce, field, e.target.value));
        fieldContainer.appendChild(label);
        fieldContainer.appendChild(input);
        detailsContent.appendChild(fieldContainer);
    });

    // Bouton de sauvegarde
    const saveButton = document.createElement('button');
    saveButton.textContent = 'Sauvegarder les modifications';
    saveButton.addEventListener('click', () => saveAnnonceChanges(annonce));
    detailsContent.appendChild(saveButton);
}

async function updateAnnonceField(annonce, field, value) {
    if (field === 'price') {
        annonce[field] = { amount: value, currency_code: annonce.price.currency_code };
    } else {
        annonce[field] = value;
    }
    await updateAnnonce(annonce);
}

async function saveAnnonceChanges(annonce) {
    try {
        await updateAnnonce(annonce);
        setStatus('Annonce mise à jour avec succès');
    } catch (error) {
        console.error('Erreur lors de la mise à jour de l\'annonce:', error);
        setStatus('Erreur lors de la mise à jour de l\'annonce', true);
    }
}


async function deleteFromVinted(vintedId) {
    try {
        const authCookie = await getAuthCookie();
        const csrfToken = await getCsrfToken();
        const anonId = await getAnonId();
        
        const response = await fetch(`https://www.vinted.fr/api/v2/items/${vintedId}/delete`, {
            method: 'POST',
            headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'fr',
                'x-csrf-token': csrfToken,
                'x-anon-id': anonId,
                'origin': 'https://www.vinted.fr',
                'referer': `https://www.vinted.fr/items/${vintedId}`,
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-origin',
                'sec-gpc': '1',
                'cookie': `_vinted_fr_session=${authCookie}`,
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Réponse de Vinted:', errorData);
            throw new Error(`Erreur HTTP: ${response.status} - ${errorData.error || 'Erreur inconnue'}`);
        }

        const data = await response.json();
        console.log('Réponse de Vinted:', data);

        if (data.success === true || data.status === 'ok') {
            console.log('Annonce supprimée avec succès de Vinted');
            return true;
        } else {
            console.error('Réponse inattendue de Vinted:', data);
            throw new Error('La suppression a échoué pour une raison inconnue');
        }
    } catch (error) {
        console.error("Erreur lors de la suppression de l'annonce sur Vinted:", error);
        throw error;
    }
}



async function identifyDeletedAnnonces() {
    const annonces = await getAllAnnonces();
    const deletedAnnonces = annonces.filter(annonce => 
        annonce.publicationStatus === 'unpublished' && annonce.deletionDate
    );
    return deletedAnnonces;
}

async function republishAnnonce(localId) {
    // Cette fonction sera implémentée plus tard pour republier une annonce
    console.log(`Republication de l'annonce ${localId} à implémenter`);
}

async function getCsrfToken() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get('csrfToken', (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else if (result.csrfToken) {
                resolve(result.csrfToken);
            } else {
                reject(new Error('CSRF Token non trouvé dans le stockage local'));
            }
        });
    });
}

async function getAnonId() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get('anonId', (result) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            } else if (result.anonId) {
                resolve(result.anonId);
            } else {
                reject(new Error('Anon ID non trouvé dans le stockage local'));
            }
        });
    });
}

function saveVintedCredentials(csrfToken, anonId) {
    chrome.storage.local.set({ csrfToken, anonId }, () => {
        if (chrome.runtime.lastError) {
            console.error('Erreur lors de la sauvegarde des credentials:', chrome.runtime.lastError);
        } else {
            console.log('Credentials Vinted sauvegardés avec succès');
        }
    });
}

