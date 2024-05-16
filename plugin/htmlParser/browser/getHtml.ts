const htmlText = "<!DOCTYPE html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "    <meta charset=\"UTF-8\">\n" +
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n" +
    "    <title>Online Shop</title>\n" +
    "    <style>\n" +
    "        /* CSS styles */\n" +
    "        body {\n" +
    "            font-family: Arial, sans-serif;\n" +
    "            margin: 0;\n" +
    "            padding: 0;\n" +
    "        }\n" +
    "\n" +
    "        header {\n" +
    "            background-color: #333;\n" +
    "            color: #fff;\n" +
    "            padding: 10px 0;\n" +
    "            text-align: center;\n" +
    "        }\n" +
    "\n" +
    "        .container {\n" +
    "            width: 80%;\n" +
    "            margin: 0 auto;\n" +
    "            padding: 20px 0;\n" +
    "        }\n" +
    "\n" +
    "        .product {\n" +
    "            border: 1px solid #ccc;\n" +
    "            padding: 10px;\n" +
    "            margin-bottom: 20px;\n" +
    "            overflow: hidden;\n" +
    "        }\n" +
    "\n" +
    "        .product img {\n" +
    "            width: 100%;\n" +
    "            height: auto;\n" +
    "        }\n" +
    "\n" +
    "        .product h2 {\n" +
    "            margin-top: 0;\n" +
    "        }\n" +
    "\n" +
    "        .product p {\n" +
    "            margin: 5px 0;\n" +
    "        }\n" +
    "\n" +
    "        footer {\n" +
    "            background-color: #333;\n" +
    "            color: #fff;\n" +
    "            text-align: center;\n" +
    "            padding: 10px 0;\n" +
    "            position: absolute;\n" +
    "            bottom: 0;\n" +
    "            width: 100%;\n" +
    "        }\n" +
    "    </style>\n" +
    "</head>\n" +
    "<body id='container'>\n" +
    "    <header>\n" +
    "        <h1>Online Shop</h1>\n" +
    "    </header>\n" +
    "    \n" +
    "    <div class=\"container\">\n" +
    "        <div class=\"product\">\n" +
    "            <img src=\"product1.jpg\" alt=\"Product 1\">\n" +
    "            <h2>Product 1</h2>\n" +
    "            <p>Description of Product 1</p>\n" +
    "            <p>Price: $XX.XX</p>\n" +
    "            <button>Add to Cart</button>\n" +
    "        </div>\n" +
    "        \n" +
    "        <div class=\"product\">\n" +
    "            <img src=\"product2.jpg\" alt=\"Product 2\">\n" +
    "            <h2>Product 2</h2>\n" +
    "            <p>Description of Product 2</p>\n" +
    "            <p>Price: $XX.XX</p>\n" +
    "            <button>Add to Cart</button>\n" +
    "        </div>\n" +
    "\n" +
    "        <!-- Add more products as needed -->\n" +
    "    </div>\n" +
    "\n" +
    "    <footer>\n" +
    "        <p>&copy; 2024 Online Shop</p>\n" +
    "    </footer>\n" +
    "</body>\n" +
    "</html>\n"
export function getHtml() : Document{

    const parser = new DOMParser();
    return parser.parseFromString(htmlText, 'text/html');
}

export function inlineRemoteCSS(htmlDoc: Document): Promise<Document> {
    const links = Array.from(htmlDoc.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];

    const fetchAndInline = (link: HTMLLinkElement) => {
        return new Promise<void>((resolve, reject) => {
            fetch(link.href)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch CSS: ${response.statusText}`);
                    }
                    return response.text();
                })
                .then(cssText => {
                    const style = htmlDoc.createElement('style');
                    style.textContent = cssText;
                    htmlDoc.head.appendChild(style);
                    link.remove();
                    resolve(); // Call resolve with void 0 or undefined
                })
                .catch(error => {
                    console.error(`Error fetching CSS: ${error}`);
                    reject(error);
                });
        });
    };

    const fetchAndInlinePromises = links.map(fetchAndInline);

    // Synchronously execute fetch and inline operations
    return fetchAndInlinePromises.reduce((chain, promise) => {
        return chain.then(() => promise);
    }, Promise.resolve())
        .then(() => htmlDoc);
}
