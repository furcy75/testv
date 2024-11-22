console.log("Content script chargé");

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Message reçu dans le content script:", request);
    if (request.action === "extractAnnonces") {
        console.log("Début de l'extraction des annonces");
        const annonces = extractAnnoncesFromPage();
        console.log("Annonces extraites:", annonces);
        sendResponse({ annonces: annonces });
    }
    return true; // Indique que la réponse sera envoyée de manière asynchrone
});

function extractAnnoncesFromPage() {
    const annonces = [];
    const annonceElements = document.querySelectorAll('.feed-grid__item');
    console.log("Nombre d'éléments d'annonce trouvés:", annonceElements.length);
    annonceElements.forEach((element, index) => {
        const titleElement = element.querySelector('.web_ui__ItemBox__title');
        if (titleElement) {
            annonces.push({
                title: titleElement.textContent.trim()
            });
        } else {
            console.log(`Pas de titre trouvé pour l'élément ${index}`);
        }
    });
    return annonces;
}

