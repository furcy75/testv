// Ce code devrait être exécuté dans un script de contenu (content script)
function extractVintedCredentials() {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
    const anonId = document.cookie.split('; ').find(row => row.startsWith('anon_id='))?.split('=')[1];

    if (csrfToken && anonId) {
        chrome.runtime.sendMessage({ 
            action: 'saveVintedCredentials', 
            csrfToken, 
            anonId 
        });
    }
}

// Exécutez cette fonction lorsque la page est chargée
extractVintedCredentials();

