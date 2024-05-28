import { convertHtmlToLayerId } from '../utils';

const htmlText = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset=UTF-8>
    <meta name=viewport content="width=device-width, initial-scale=1.0">
    <title>Online Shop</title>
    <style>
        /* CSS styles */
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
        }

        header {
            background-color: #333;
            color: #fff;
            padding: 10px 0;
            text-align: center;
        }

        .container {
            width: 80%;
            margin: 0 auto;
            padding: 20px 0;
        }

        .product {
            border: 1px solid #ccc;
            padding: 10px;
            margin-bottom: 20px;
            overflow: hidden;
        }

        .product img {
            width: 100%;
            height: auto;
        }

        .product h2 {
            margin-top: 0;
        }

        .product p {
            margin: 5px 0;
        }

        footer {
            background-color: #333;
            color: #fff;
            text-align: center;
            padding: 10px 0;
            position: absolute;
            bottom: 0;
            width: 100%;
        }
    </style>
</head>
<body id=container>
    <header>
        <h1>Online Shop</h1>
    </header>
    
    <div class=container>
        <div class=product>
            <img src=product1.jpg alt="Product 1">
            <h2>Product 1</h2>
            <p>Description of Product 1</p>
            <p>Price: $XX.XX</p>
            <button>Add to Cart</button>
        </div>
        
        <div class=product>
            <img src=product2.jpg alt="Product 2">
            <h2>Product 2</h2>
            <p>Description of Product 2</p>
            <p>Price: $XX.XX</p>
            <button>Add to Cart</button>
        </div>

        <!-- Add more products as needed -->
    </div>

    <footer>
        <p>&copy; 2024 Online Shop</p>
    </footer>
</body>
</html>`;

const htmlTxt = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recommended Books</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f9;
            color: #333;
            line-height: 1.6;
        }

        header {
            background-color: #4CAF50;
            color: white;
            padding: 1rem 0;
            text-align: center;
            margin-bottom: 2rem;
        }

        h1 {
            margin: 0;
        }

        main {
            max-width: 800px;
            margin: 0 auto;
            padding: 0 1rem;
        }

        .book-list {
            display: flex;
            flex-direction: column;
            gap: 2rem;
        }

        .book-item {
            background-color: white;
            padding: 1rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .book-title {
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
        }

        .book-author,
        .book-description {
            font-size: 1rem;
            margin-bottom: 0.5rem;
        }
    </style>
</head>
<body>
    <header>
        <h1>Recommended Books</h1>
    </header>
    <main>
        <div class="book-list">
            <div class="book-item">
                <h2 class="book-title">Book Title 1</h2>
                <p class="book-author">Author: Author Name 1</p>
                <p class="book-description">Description: This is a brief description of Book Title 1.</p>
            </div>
            <div class="book-item">
                <h2 class="book-title">Book Title 2</h2>
                <p class="book-author">Author: Author Name 2</p>
                <p class="book-description">Description: This is a brief description of Book Title 2.</p>
            </div>
            <div class="book-item">
                <h2 class="book-title">Book Title 3</h2>
                <p class="book-author">Author: Author Name 3</p>
                <p class="book-description">Description: This is a brief description of Book Title 3.</p>
            </div>
        </div>
    </main>
</body>
</html>
`;
export function getHtml(wireframeId: string): Document {
  const parser = new DOMParser();
  //Todo fetch htmlTxt by wireframeId and userAuthToken
  const htmlDoc = parser.parseFromString(htmlTxt, 'text/html');

  // Set the id on the body tag if it doesn't already have one
  if (!htmlDoc.body.id) {
    htmlDoc.body.id = convertHtmlToLayerId;
  }

  return htmlDoc;
}

export function inlineRemoteCSS(htmlDoc: Document): Promise<Document> {
  const links = Array.from(
    htmlDoc.querySelectorAll('link[rel="stylesheet"]')
  ) as HTMLLinkElement[];

  const fetchAndInline = (link: HTMLLinkElement) => {
    return new Promise<void>((resolve, reject) => {
      fetch(link.href)
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Failed to fetch CSS: ${response.statusText}`);
          }
          return response.text();
        })
        .then((cssText) => {
          const style = htmlDoc.createElement('style');
          style.textContent = cssText;
          htmlDoc.head.appendChild(style);
          link.remove();
          resolve(); // Call resolve with void 0 or undefined
        })
        .catch((error) => {
          console.error(`Error fetching CSS: ${error}`);
          reject(error);
        });
    });
  };

  const fetchAndInlinePromises = links.map(fetchAndInline);

  // Synchronously execute fetch and inline operations
  return fetchAndInlinePromises
    .reduce((chain, promise) => {
      return chain.then(() => promise);
    }, Promise.resolve())
    .then(() => htmlDoc);
}
