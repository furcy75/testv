const dbName = "VintedDB";
const storeName = "annonces";
const imageStoreName = "images";

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 3);
        request.onerror = () => reject("Erreur d'ouverture de la base de données");
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                const store = db.createObjectStore(storeName, { keyPath: "localId" });
                store.createIndex("vintedId", "id", { unique: true });
            }
            if (!db.objectStoreNames.contains(imageStoreName)) {
                db.createObjectStore(imageStoreName);
            }
        };
    });
}

export async function saveAnnonces(annonces) {
    const db = await openDB();
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        annonces.forEach(annonce => {
            if (!annonce.localId) {
                annonce.localId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            }
            if (!annonce.createdInDB) {
                annonce.createdInDB = Math.floor(Date.now() / 1000); // Timestamp en secondes
            }
            store.put(annonce);
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject("Erreur lors de la sauvegarde des annonces");
    });
}



export async function getAllAnnonces() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readonly");
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("Erreur lors de la récupération des annonces");
    });
}


export async function deleteAnnonce(localId) {
    const db = await openDB();
    const transaction = db.transaction([storeName, imageStoreName], "readwrite");
    const store = transaction.objectStore(storeName);
    const imageStore = transaction.objectStore(imageStoreName);

    return new Promise((resolve, reject) => {
        store.delete(localId);
        const imageRequest = imageStore.delete(localId);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject("Erreur lors de la suppression de l'annonce");
    });
}

export async function saveImage(localId, imageBlob, index) {
    const db = await openDB();
    const transaction = db.transaction(imageStoreName, "readwrite");
    const store = transaction.objectStore(imageStoreName);

    return new Promise((resolve, reject) => {
        const key = `${localId}_${index}`;
        const request = store.put(imageBlob, key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject("Erreur lors de la sauvegarde de l'image");
    });
}

export async function getImage(localId, index) {
    const db = await openDB();
    const transaction = db.transaction(imageStoreName, "readonly");
    const store = transaction.objectStore(imageStoreName);

    return new Promise((resolve, reject) => {
        const key = `${localId}_${index}`;
        const request = store.get(key);
        request.onsuccess = () => {
            const result = request.result;
            if (result instanceof Blob) {
                resolve(result);
            } else if (result) {
                // Si le résultat n'est pas un Blob mais existe, essayons de le convertir en Blob
                resolve(new Blob([result], { type: 'image/jpeg' }));
            } else {
                resolve(null); // Aucune image trouvée
            }
        };
        request.onerror = () => reject("Erreur lors de la récupération de l'image");
    });
}



export async function exportDB() {
    const annonces = await getAllAnnonces();
    const exportData = { annonces: annonces, images: {} };

    const db = await openDB();
    const imageTransaction = db.transaction(imageStoreName, "readonly");
    const imageStore = imageTransaction.objectStore(imageStoreName);

    return new Promise((resolve, reject) => {
        imageStore.openCursor().onsuccess = function (event) {
            const cursor = event.target.result;
            if (cursor) {
                exportData.images[cursor.key] = cursor.value;
                cursor.continue();
            } else {
                const blob = new Blob([JSON.stringify(exportData)], { type: "application/json" });
                resolve(URL.createObjectURL(blob));
            }
        };
    });
}

export async function clearDatabase() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([storeName, imageStoreName], "readwrite");
        const annonceStore = transaction.objectStore(storeName);
        const imageStore = transaction.objectStore(imageStoreName);

        annonceStore.clear();
        imageStore.clear();

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(new Error("Erreur lors de la réinitialisation de la base de données"));
    });
}

export async function getAnnonceByLocalId(localId) {
    const db = await openDB();
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.get(localId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("Erreur lors de la récupération de l'annonce");
    });
}

export async function getAnnonceByVintedId(vintedId) {
    const db = await openDB();
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const index = store.index("vintedId");

    return new Promise((resolve, reject) => {
        const request = index.get(vintedId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("Erreur lors de la récupération de l'annonce par ID Vinted");
    });
}

export async function getAnnonceBySimilarity(title, price, description) {
    const db = await openDB();
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.openCursor();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const annonce = cursor.value;
                if (annonce.title === title && annonce.price.amount === price.amount && annonce.description === description) {
                    resolve(annonce);
                    return;
                }
                cursor.continue();
            } else {
                resolve(null);
            }
        };
        request.onerror = () => reject("Erreur lors de la recherche d'annonce similaire");
    });
}

export async function updateAnnonce(annonce) {
    const db = await openDB();
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.put(annonce);
        request.onsuccess = () => resolve();
        request.onerror = () => reject("Erreur lors de la mise à jour de l'annonce");
    });
}

export async function saveAnnonce(annonce) {
    const db = await openDB();
    const transaction = db.transaction(storeName, "readwrite");
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
        const request = store.add(annonce);
        request.onsuccess = () => resolve();
        request.onerror = () => reject("Erreur lors de la sauvegarde de l'annonce");
    });
}

function generateLocalId() {
    return `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

