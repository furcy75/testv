chrome.runtime.onInstalled.addListener(() => {
    if (chrome.sidePanel) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
            .catch(error => console.error("Erreur lors de la configuration du panneau latéral:", error));
    } else {
        console.warn("L'API sidePanel n'est pas disponible. Assurez-vous d'utiliser Chrome 114 ou supérieur.");
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'saveVintedCredentials') {
        saveVintedCredentials(message.csrfToken, message.anonId);
    }
});


chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (chrome.sidePanel) {
        if (changeInfo.status === 'complete' && tab.url && tab.url.includes('vinted.fr')) {
            chrome.sidePanel.setOptions({
                tabId,
                path: 'sidepanel.html',
                enabled: true
            }).catch(error => console.error("Erreur lors de l'activation du panneau latéral:", error));
        } else if (tab.url && !tab.url.includes('vinted.fr')) {
            chrome.sidePanel.setOptions({
                tabId,
                enabled: false
            }).catch(error => console.error("Erreur lors de la désactivation du panneau latéral:", error));
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "downloadImage") {
        fetch(request.url)
            .then(response => {
                const contentType = response.headers.get('content-type');
                return response.arrayBuffer().then(buffer => ({ buffer, type: contentType }));
            })
            .then(({ buffer, type }) => {
                sendResponse({
                    buffer: Array.from(new Uint8Array(buffer)),
                    type: type || 'image/jpeg' // Fallback to JPEG if type is not provided
                });
            })
            .catch(error => {
                console.error("Erreur lors du téléchargement de l'image:", error);
                sendResponse({ error: error.message });
            });
        return true;
    }

    if (request.action === "getAuthCookie") {
        chrome.cookies.get({ url: "https://www.vinted.fr", name: "_vinted_fr_session" }, cookie => {
            sendResponse({ cookie: cookie ? cookie.value : null });
        });
        return true; // Indique que la réponse sera envoyée de manière asynchrone
    }
});





console.log("Background script chargé");

