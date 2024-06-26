import { BuilderElement } from '@builder.io/sdk';
import { createRef, RefObject } from 'react';
import {
  createMuiTheme,
  CssBaseline,
  Divider,
  MuiThemeProvider,
  MenuItem,
  withStyles,
  Tabs,
  Tab,
} from '@material-ui/core';
import green from '@material-ui/core/colors/green';
import * as fileType from 'file-type';
import { action, computed, observable, when } from 'mobx';
import { observer } from 'mobx-react';
import * as pako from 'pako';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as md5 from 'spark-md5';
import * as traverse from 'traverse';
import { arrayBufferToBase64 } from '../lib/functions/buffer-to-base64';
import { SafeComponent } from './classes/safe-component';
import { settings } from './constants/settings';
import { theme as themeVars } from './constants/theme';
import { deepClone, fastClone } from './functions/fast-clone';
import { transformWebpToPNG } from './functions/encode-images';
import { traverseLayers } from './functions/traverse-layers';
import './ui.css';
import { IntlProvider, FormattedMessage } from 'react-intl';
import { en, ru } from './localize/i18n';
import { CheckListContent } from './constants/utils';
import * as amplitude from './functions/track';
import { v4 as uuid } from 'uuid';
import { useDev } from './constants/use-dev';
import { context, htmlToFigmaFrame } from './htmlParser/browser';
import { LayerNode } from './htmlParser/types';
import { getHtml } from './htmlParser/browser/getHtml';
import { convertHtmlToLayerId } from './htmlParser/utils';

// https://stackoverflow.com/a/46634877
type Writeable<T> = { -readonly [P in keyof T]: T[P] };

interface HtmlSerializerState {
  serializedHtml: string;
}

export const setContext = (window: Window) => {
  context.document = window.document;
  // @ts-expect-error
  context.window = window;
};
export const apiHost = useDev ? 'http://localhost:4000' : 'https://builder.io';
amplitude.initialize();

const sendToFigma = (layers: LayerNode) => {
  window.parent.postMessage(
    {
      pluginMessage: {
        type: 'import',
        data: {
          layers,
        },
      },
    },
    '*'
  );
};

const selectionToBuilder = async (
  selection: SceneNode[]
): Promise<BuilderElement[]> => {
  const useGzip = true;

  selection = deepClone(selection);

  traverse(selection).forEach(function (item) {
    if (this.key === 'intArr') {
      this.delete();
    }
  });

  const res = await fetch(`${apiHost}/api/v1/figma-to-builder`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(
      useGzip
        ? {
            compressedNodes: pako.deflate(JSON.stringify(selection), {
              to: 'string',
            }),
          }
        : {
            nodes: selection,
          }
    ),
  }).then((res) => {
    if (!res.ok) {
      console.error('Figma-to-builder request failed', res);
      amplitude.track('export error', {
        message: 'Figma-to-builder request failed',
      });
      throw new Error('Figma-to-builder request failed');
    }
    return res.json();
  });
  return res.blocks;
};

export interface ClientStorage {
  imageUrlsByHash?: { [hash: string]: string | null };
  userId?: string;
  openAiKey?: string;
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
  style?: React.CSSProperties;
}

const apiKey = process.env.API_KEY || null;

const clamp = (num: number, min: number, max: number) =>
  Math.max(min, Math.min(max, num));

type Node = TextNode | RectangleNode;

const theme = createMuiTheme({
  typography: themeVars.typography,
  palette: {
    primary: { main: themeVars.colors.primary },
    secondary: green,
  },
  overrides: {
    MuiButtonBase: {
      root: {
        boxShadow: 'none !important',
      },
    },
    MuiTooltip: {
      tooltip: {
        fontSize: 13,
        backgroundColor: 'rgba(45, 45, 45, 0.95)',
        padding: '7px 11px',
      },
    },
  },
  props: {
    MuiButtonBase: {
      style: {
        boxShadow: 'none !important',
      },
      // The properties to apply
      disableRipple: true, // No more ripple, on the whole application 💣!
    },
  },
});

const StyledButton = withStyles({
  root: {
    fontSize: '12px',
    padding: '8px',
    height: '30px',
    minHeight: 'unset',
    display: 'flex',
    justifyContent: 'center',
  },
})(MenuItem);

const BASE64_MARKER = ';base64,';
function convertDataURIToBinary(dataURI: string) {
  const base64Index = dataURI.indexOf(BASE64_MARKER) + BASE64_MARKER.length;
  const base64 = dataURI.substring(base64Index);
  const raw = window.atob(base64);
  const rawLength = raw.length;
  const array = new Uint8Array(new ArrayBuffer(rawLength));

  for (let i = 0; i < rawLength; i++) {
    array[i] = raw.charCodeAt(i);
  }
  return array;
}

export function getImageFills(layer: Node) {
  return (
    Array.isArray(layer.fills) &&
    layer.fills
      .filter(
        (item) =>
          item.type === 'IMAGE' && item.visible !== false && item.opacity !== 0
      )
      .sort((a, b) => b.opacity - a.opacity)
  );
}

// TODO: CACHE!
// const imageCache: { [key: string]: Uint8Array | undefined } = {};
export async function processImages(layer: Node) {
  const images = getImageFills(layer);

  const convertToSvg = (value: string) => {
    (layer as any).type = 'SVG';
    (layer as any).svg = value;
    if (typeof layer.fills !== 'symbol') {
      layer.fills = layer.fills.filter((item) => item.type !== 'IMAGE');
    }
  };
  if (!images) {
    return Promise.resolve([]);
  }

  type AugmentedImagePaint = Writeable<ImagePaint> & {
    intArr?: Uint8Array;
    url?: string;
  };

  return Promise.all(
    images.map(async (image: AugmentedImagePaint) => {
      try {
        if (!image || !image.url) {
          return;
        }

        const url = image.url;
        if (url.startsWith('data:')) {
          const type = url.split(/[:,;]/)[1];
          if (type.includes('svg')) {
            const svgValue = decodeURIComponent(url.split(',')[1]);
            convertToSvg(svgValue);
            return Promise.resolve();
          } else {
            if (url.includes(BASE64_MARKER)) {
              image.intArr = convertDataURIToBinary(url);
              delete image.url;
            } else {
              console.info('Found data url that could not be converted', url);
            }
            return;
          }
        }

        const isSvg = url.endsWith('.svg');

        // Proxy returned content through Builder so we can access cross origin for
        // pulling in photos, etc
        const res = await fetch(
          `${apiHost}/api/v1/proxy-api?url=${encodeURIComponent(url)}`
        );

        const contentType = res.headers.get('content-type');
        if (isSvg || contentType?.includes('svg')) {
          const text = await res.text();
          convertToSvg(text);
        } else {
          const arrayBuffer = await res.arrayBuffer();
          const type = fileType(arrayBuffer);
          if (type && (type.ext.includes('svg') || type.mime.includes('svg'))) {
            convertToSvg(await res.text());
            return;
          } else {
            const intArr = new Uint8Array(arrayBuffer);
            delete image.url;

            if (
              type &&
              (type.ext.includes('webp') || type.mime.includes('image/webp'))
            ) {
              image.intArr = await transformWebpToPNG(intArr);
            } else {
              image.intArr = intArr;
            }
          }
        }
      } catch (err) {
        console.warn('Could not fetch image', layer, err);
      }
    })
  );
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index } = props;

  return value === index ? (
    <div
      style={{
        flexGrow: 1,
        ...props.style,
      }}
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
    >
      {value === index && children}
    </div>
  ) : null;
}

@observer
class App extends SafeComponent {
  editorRef: HTMLIFrameElement | null = null;

  @observable loading = false;
  @observable loadingCmsData = false;

  @observable lipsum = false;
  @observable loadingGenerate = false;
  @observable clientStorage: ClientStorage | null = null;
  @observable errorMessage = '';

  @observable generatingCode = false;
  @observable urlValue = 'https://www.builder.io';
  @observable width = '1200';
  @observable online = navigator.onLine;
  @observable useFrames = false;
  @observable inDevMode: boolean = false;
  @observable devModeClickCount: number = 0;
  @observable showMoreOptions = true;
  @observable selection: (BaseNode & { data?: { [key: string]: any } })[] = [];
  @observable.ref selectionWithImages:
    | (BaseNode & {
        data?: { [key: string]: any };
      })[]
    | null = null;

  @observable commandKeyDown = false;
  @observable shiftKeyDown = false;
  @observable altKeyDown = false;
  @observable ctrlKeyDown = false;
  @observable showRequestFailedError = false;
  @observable showImportInvalidError = false;
  @observable isValidImport: null | boolean = null;
  @observable.ref previewData: any;
  @observable displayFiddleUrl = '';
  @observable currentLanguage = 'en';
  @observable tabIndex = 0;
  @observable showDevModeOption: boolean = false;
  @observable figmaCheckList: {
    results?: CheckListContent[];
  } = {};
  @observable loaderContent: CheckListContent[] = [
    {
      id: '1a',
      data: {
        type: 'during',
        textContent:
          'Getting everything ready... This can take a few minutes to complete.',
      },
    },
  ];

  editorScriptAdded = false;
  dataToPost: any;

  // TODO: THIS IS UNUSED
  async getImageUrl(
    intArr: Uint8Array,
    imageHash?: string
  ): Promise<string | null> {
    const hash = imageHash ?? md5.ArrayBuffer.hash(intArr);
    const fromCache = hash && this.clientStorage?.imageUrlsByHash?.[hash];

    if (fromCache) {
      console.debug('Used URL from cache', fromCache);
      return fromCache;
    }
    if (!apiKey) {
      console.warn('Tried to upload image without API key');
      return null;
    }

    return fetch(`${apiHost}/api/v1/upload?apiKey=${apiKey}`, {
      method: 'POST',
      body: JSON.stringify({
        image: arrayBufferToBase64(intArr),
      }),
      headers: {
        'content-type': 'application/json',
      },
    })
      .then((res) => res.json())
      .then((data) => {
        const { url } = data;
        if (typeof url !== 'string') {
          return null;
        }
        if (this.clientStorage && hash) {
          if (!this.clientStorage.imageUrlsByHash) {
            this.clientStorage.imageUrlsByHash = {};
          }
          this.clientStorage.imageUrlsByHash[hash] = url;
        }

        return url;
      });
  }

  getDataForSelection(name: string, multipleValuesResponse = null) {
    if (!this.selection.length) {
      return multipleValuesResponse;
    }
    const firstNode = this.selection[0];
    let value = firstNode.data && firstNode.data[name];
    for (const item of this.selection.slice(1)) {
      const itemValue = item.data && item.data[name];
      if (itemValue !== value) {
        return multipleValuesResponse;
      }
    }
    return value;
  }

  async updateStorage() {
    await when(() => !!this.clientStorage);
    parent.postMessage(
      {
        pluginMessage: {
          type: 'setStorage',
          data: fastClone(this.clientStorage),
        },
      },
      '*'
    );
  }

  setDataForSelection(name: string, value: any) {
    for (const node of this.selection) {
      if (!node.data) {
        node.data = {
          [name]: value,
        };
      } else {
        node.data[name] = value;
      }
    }
    // TODO: throttleNextTick
    this.saveUpdates();
  }

  form: HTMLFormElement | null = null;
  urlInputRef: HTMLInputElement | null = null;
  // iframeRef: HTMLIFrameElement | null = null;

  @computed get urlValid() {
    function validURL(str: string) {
      var pattern = new RegExp(
        '^(https?:\\/\\/)?' + // protocol
          '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
          '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
          '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
          '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
          '(\\#[-a-z\\d_]*)?$',
        'i'
      ); // fragment locator
      return !!pattern.test(str);
    }

    return validURL(this.urlValue);
  }

  @action
  updateKeyPositions(event: KeyboardEvent) {
    this.commandKeyDown = event.metaKey;
    this.altKeyDown = event.altKey;
    this.shiftKeyDown = event.shiftKey;
    this.ctrlKeyDown = event.ctrlKey;
  }

  @action
  async getCode(useFiddle = false) {
    this.displayFiddleUrl = '';
    this.showImportInvalidError = false;
    this.showRequestFailedError = false;
    if (!this.lipsum) {
      this.selectionWithImages = null;
      parent.postMessage(
        {
          pluginMessage: {
            type: 'getSelectionWithImages',
          },
        },
        '*'
      );

      this.generatingCode = true;

      await when(() => !!this.selectionWithImages);
    } else {
      this.selectionWithImages = this.selection;
    }

    if (!(this.selectionWithImages && this.selectionWithImages[0])) {
      console.warn('No selection with images');
      return;
    }

    // TODO: analyze if page is properly nested and annotated, if not
    // suggest in the UI what needs grouping
    let selectionToBuilderPromise;
    if (!this.inDevMode) {
      selectionToBuilderPromise = selectionToBuilder(
        this.selectionWithImages as any
      ).catch((err) => {
        this.loadingGenerate = false;
        this.generatingCode = false;
        this.showRequestFailedError = true;
        amplitude.track('export error');
        throw err;
      });
    } else {
      const selections = deepClone(this.selectionWithImages);
      traverse(selections).forEach(function () {
        if (this.key === 'intArr') {
          this.delete();
        }
      });
      selectionToBuilderPromise = Promise.resolve(selections);
    }

    const imagesPromises: Promise<any>[] = [];
    const imageMap: { [key: string]: string } = {};
    for (const layer of this.selectionWithImages as SceneNode[]) {
      traverseLayers(layer, (node) => {
        const imageFills = getImageFills(node as Node);
        if (Array.isArray(imageFills) && imageFills.length && !this.inDevMode) {
          imageFills.forEach((image) => {
            if ((image as any)?.intArr) {
              imagesPromises.push(
                (async () => {
                  const { id } = await fetch(`${apiHost}/api/v1/stage-image`, {
                    method: 'POST',
                    body: JSON.stringify({
                      image: arrayBufferToBase64((image as any).intArr),
                    }),
                    headers: {
                      'content-type': 'application/json',
                    },
                  }).then((res) => {
                    if (!res.ok) {
                      console.error('Image upload failed', res);
                      throw new Error('Image upload failed');
                    }
                    return res.json();
                  });
                  delete (node as any).intArr;
                  imageMap[node.id] = id;
                })()
              );
            }
          });
        }
      });
    }

    const blocks = await selectionToBuilderPromise;
    await Promise.all(imagesPromises).catch((err) => {
      this.loadingGenerate = false;
      this.generatingCode = false;
      this.showRequestFailedError = true;
      amplitude.track('export error');
      throw err;
    });

    traverse(blocks).forEach((item) => {
      if (item?.['@type'] === '@builder.io/sdk:Element') {
        const image = imageMap[item.meta?.figmaLayerId];
        if (image) {
          const url = `https://cdn.builder.io/api/v1/image/assets%2FTEMP%2F${image}`;
          if (item.component?.options) {
            item.component.options.image = url;
          } else if (item.responsiveStyles?.large?.backgroundImage) {
            item.responsiveStyles.large.backgroundImage = `url("${url}")`;
          }
        }
      }
    });

    const data = {
      data: {
        blocks: blocks,
      },
    };

    this.isValidImport = null;
    if (this.inDevMode) {
      // In the case of dev mode
      // We don't care about autolayout
      this.isValidImport = true;
    } else {
      parent.postMessage(
        {
          pluginMessage: {
            type: 'checkIfCanGetCode',
          },
        },
        '*'
      );
    }

    this.generatingCode = true;

    await when(() => typeof this.isValidImport === 'boolean');
    if (!this.isValidImport) {
      this.generatingCode = false;
      this.isValidImport = null;
      this.showImportInvalidError = true;
      amplitude.track('import error');
      return;
    }
    this.isValidImport = null;

    const json = JSON.stringify(data);

    // Always only download in dev mode
    if (useFiddle && !this.inDevMode) {
      const res = await fetch(apiHost + '/api/v1/fiddle', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: json,
      })
        .then((res) => {
          if (!res.ok) {
            console.error('Failed to create fiddle', res);
            throw new Error('Failed to create fiddle');
          }
          return res.json();
        })
        .catch((err) => {
          this.generatingCode = false;
          this.selectionWithImages = null;
          this.showRequestFailedError = true;
          amplitude.track('fiddle creation failed');

          throw err;
        });
      if (res.url) {
        open(res.url, '_blank');
        this.displayFiddleUrl = res.url;
      }
      this.generatingCode = false;
      this.selectionWithImages = null;

      amplitude.incrementUserProps('export_count');
      amplitude.track('export to builder', {
        url: this.displayFiddleUrl,
        type: 'fiddle',
      });
    } else {
      const blob = new Blob([json], {
        type: 'application/json',
      });

      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', 'page.builder.json');
      document.body.appendChild(link); // Required for FF

      link.click();
      document.body.removeChild(link);

      this.generatingCode = false;
      this.selectionWithImages = null;
      amplitude.incrementUserProps('export_count');
      amplitude.track('export to builder', {
        type: 'json',
      });
    }
  }

  @observable initialized = false;
  iframeRef: RefObject<HTMLIFrameElement>;
  constructor(props: any) {
    super(props);
    this.state = {
      serializedHtml: 'default',
      userAuthToken: null,
      sitemaps: [],
      pages: [],
      pageSection: [],
      selectedSitemapId: null,
      selectedPageId: null,
      loading: true,
      errorMessage: '',
    };
    this.iframeRef = createRef();
  }

  render() {
    const {
      sitemaps,
      pages,
      pageSection,
      loading,
      errorMessage,
      selectedSitemapId,
      selectedPageId,
    } = this.state;

    if (loading) {
      return <div>Loading...</div>;
    }

    if (errorMessage) {
      return <div>Error: {errorMessage}</div>;
    }

    return (
      <IntlProvider
        messages={this.currentLanguage === 'en' ? en : ru}
        locale={this.currentLanguage}
        defaultLocale="en"
      >
        <html>
          <head>{/* Your head content here */}</head>
          <body>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              <Tabs
                variant="fullWidth"
                style={{
                  minHeight: 40,
                  backgroundColor: '#F9F9F9',
                  flexShrink: 0,
                  width: settings.ui.baseWidth,
                  borderRight: '1px solid #ccc',
                }}
                TabIndicatorProps={{
                  style: { transition: 'none' },
                }}
                value={this.tabIndex}
                onChange={this.switchTab}
                indicatorColor="primary"
                textColor="primary"
              >
                <Tab
                  style={{
                    minHeight: 40,
                    minWidth: 0,
                  }}
                  label={
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 'bold',
                        textTransform: 'none',
                      }}
                    >
                      Html to Figma
                    </span>
                  }
                />
              </Tabs>
              <Divider style={{ width: settings.ui.baseWidth }} />
              <iframe
                id="html_to_figma_layer_id"
                ref={this.iframeRef}
                style={{
                  width: '100%',
                  height: '500px',
                  position: 'absolute',
                  left: '-9999px',
                }}
              />
              <TabPanel value={this.tabIndex} index={0}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    zIndex: 3,
                    maxWidth: settings.ui.baseWidth,
                    fontWeight: 400,
                    marginBottom: 10,
                    padding: 5,
                  }}
                >
                  <div
                    style={{
                      marginTop: 10,
                      marginBottom: 15,
                      textTransform: 'none',
                      backgroundColor: '#007bff',
                      color: 'white',
                      padding: '10px 20px',
                      borderRadius: 4,
                      display: 'inline-block',
                      width: '100%',
                      textAlign: 'center',
                      transition: 'background-color 0.3s',
                    }}
                  >
                    <FormattedMessage
                      id="formattedMessage"
                      defaultMessage="Convert html to layers"
                    />
                  </div>
                </div>
              </TabPanel>
              {selectedSitemapId ? (
                <div>
                  {selectedPageId ? (
                    <div>
                      <h2>Sections for Page ID: {selectedPageId}</h2>
                      <ul
                        style={{ listStyleType: 'none', padding: 0, margin: 0 }}
                      >
                        {pageSection.map((section: any) => (
                          <li
                            key={section.section_id}
                            onClick={() =>
                              this.handleSectionSelect(
                                section,
                                section.section_id
                              )
                            }
                            style={{
                              cursor: 'pointer',
                              padding: '10px 15px',
                              marginBottom: '5px',
                              backgroundColor: '#f9f9f9',
                              borderRadius: '4px',
                              transition:
                                'background-color 0.3s, transform 0.3s',
                            }}
                            onMouseEnter={(e) => {
                              (e.target as HTMLElement).style.backgroundColor =
                                '#e0e0e0';
                              (e.target as HTMLElement).style.transform =
                                'scale(1.02)';
                            }}
                            onMouseLeave={(e) => {
                              (e.target as HTMLElement).style.backgroundColor =
                                '#f9f9f9';
                              (e.target as HTMLElement).style.transform =
                                'scale(1)';
                            }}
                          >
                            {section.name} - {section.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div>
                      <h2>Pages for Sitemap ID: {selectedSitemapId}</h2>
                      <ul
                        style={{ listStyleType: 'none', padding: 0, margin: 0 }}
                      >
                        {pages.map((page: any) => (
                          <li
                            key={page.page_id}
                            onClick={() => this.handlePageSelect(page.page_id)}
                            style={{
                              cursor: 'pointer',
                              padding: '10px 15px',
                              marginBottom: '5px',
                              backgroundColor: '#f9f9f9',
                              borderRadius: '4px',
                              transition:
                                'background-color 0.3s, transform 0.3s',
                            }}
                            onMouseEnter={(e) => {
                              (e.target as HTMLElement).style.backgroundColor =
                                '#e0e0e0';
                              (e.target as HTMLElement).style.transform =
                                'scale(1.02)';
                            }}
                            onMouseLeave={(e) => {
                              (e.target as HTMLElement).style.backgroundColor =
                                '#f9f9f9';
                              (e.target as HTMLElement).style.transform =
                                'scale(1)';
                            }}
                          >
                            {page.page_id} - {page.title} - {page.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <h2>Select a Sitemap</h2>
                  <ul style={{ listStyleType: 'none', padding: 0, margin: 0 }}>
                    {sitemaps.map((sitemap: any) => (
                      <li
                        key={sitemap.sitemap_id}
                        onClick={() =>
                          this.handleSitemapSelect(sitemap.sitemap_id)
                        }
                        style={{
                          cursor: 'pointer',
                          padding: '10px 15px',
                          marginBottom: '5px',
                          backgroundColor: '#f9f9f9',
                          borderRadius: '4px',
                          transition: 'background-color 0.3s, transform 0.3s',
                        }}
                        onMouseEnter={(e) => {
                          (e.target as HTMLElement).style.backgroundColor =
                            '#e0e0e0';
                          (e.target as HTMLElement).style.transform =
                            'scale(1.02)';
                        }}
                        onMouseLeave={(e) => {
                          (e.target as HTMLElement).style.backgroundColor =
                            '#f9f9f9';
                          (e.target as HTMLElement).style.transform =
                            'scale(1)';
                        }}
                      >
                        {sitemap.sitemap_id} - {sitemap.user_query}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </body>
        </html>
      </IntlProvider>
    );
  }

  componentDidMount() {
    this.setupLoginForm();
    this.fetchSitemaps();
    this.initializeEventListeners();
  }

  setupLoginForm() {
    const usernameElement = document.getElementById(
      'username'
    ) as HTMLInputElement | null;
    const passwordElement = document.getElementById(
      'password'
    ) as HTMLInputElement | null;

    const loginForm = document.getElementById('login-form');
    const reactPage = document.getElementById('react-page');

    if (usernameElement && passwordElement && loginForm && reactPage) {
      const loginButton = document.getElementById('login-button');
      if (loginButton) {
        loginButton.addEventListener('click', () => {
          const username = usernameElement.value;
          const password = passwordElement.value;

          if (username === 'p' && password === 'p') {
            loginForm.style.display = 'none';
            reactPage.style.display = 'block';

            fetch('https://api.rawii.ai/api/authenticate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                login: 'har17bar',
                password: 'root',
                rememberMe: true,
              }),
            })
              .then((response) => {
                if (!response.ok) {
                  throw new Error('Network response was not ok');
                }
                return response.json();
              })
              .then((data) => {
                if (data.token) {
                  this.setState({ userAuthToken: data.token });
                  this.fetchSitemaps(); // Fetch sitemaps after successful login
                }
              })
              .catch((error) => {
                console.error(
                  'There was a problem with the fetch operation:',
                  error
                );
              });
          } else {
            alert('Invalid username or password');
          }
        });
      }
    }
  }

  fetchSitemaps() {
    this.setState({ loading: true });
    fetch('https://dev-api.dlta.ai/ws/sitemaps/?user_id=102', {
      headers: { Authorization: `Bearer ${this.state.userAuthToken}` },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Cannot fetch sitemaps');
        }
        return response.json();
      })
      .then((data) => {
        this.setState({ sitemaps: data, loading: false });
      })
      .catch((error) => {
        console.error('Error fetching sitemaps:', error);
        this.setState({
          loading: false,
          errorMessage: 'Error fetching sitemaps',
        });
      });
  }

  handleSitemapSelect(sitemapId: string) {
    this.setState({ selectedSitemapId: sitemapId, loading: true });
    fetch(
      `https://dev-api.dlta.ai/ws/sitemap/pages/?sitemap_id=${sitemapId}&user_id=102`,
      {
        headers: { Authorization: `Bearer ${this.state.userAuthToken}` },
      }
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error('Cannot fetch pages');
        }
        return response.json();
      })
      .then((data) => {
        this.setState({ pages: data, loading: false });
      })
      .catch((error) => {
        console.error('Error fetching pages:', error);
        this.setState({ loading: false, errorMessage: 'Error fetching pages' });
      });
  }

  handlePageSelect(pageId: string) {
    this.setState({ selectedPageId: pageId, loading: true });
    console.log(pageId, '_____');
    const { selectedSitemapId } = this.state;
    fetch(
      `https://dev-api.dlta.ai/ws/sitemap/page/sections/?sitemap_id=${selectedSitemapId}&user_id=102&page_id=${pageId}`,
      {
        headers: { Authorization: `Bearer ${this.state.userAuthToken}` },
      }
    )
      .then((response) => {
        if (!response.ok) {
          throw new Error('Cannot fetch pages');
        }
        return response.json();
      })
      .then((data) => {
        console.log(data, '+++++++');
        this.setState({ pageSection: data, loading: false });
      })
      .catch((error) => {
        console.error('Error fetching pages:', error);
        this.setState({ loading: false, errorMessage: 'Error fetching pages' });
      });
  }

  handleSectionSelect(section: any, section_id: any) {
    console.log(section_id, 'section_id');
    console.log(section, 'section');
    console.log(section.html_css_content, 'section.html_css_content');

    const result = `<html>
        <body>
        ${section.html_css_content}
        </body>
     </html>`;
    console.log(result, 'resultresult');

    const parser = new DOMParser();
    //Todo fetch htmlTxt by wireframeId and userAuthToken
    const htmlDoc = parser.parseFromString(result, 'text/html');

    // Set the id on the body tag if it doesn't already have one
    if (!htmlDoc.body.id) {
      htmlDoc.body.id = convertHtmlToLayerId;
    }

    const serializedHtml = new XMLSerializer().serializeToString(htmlDoc);

    // Update state with serialized HTML and ensure the iframe is ready before proceeding
    this.setState({ serializedHtml }, () => {
      this.injectHtmlIntoIframe(); // Inject HTML into iframe

      // Call handleHtmlToFigma after the iframe is ready
      this.handleHtmlToFigma()
        .then(() => {
          // Code to execute after handleHtmlToFigma completes
        })
        .catch((error) => {
          // Handle any errors
          console.error('Error:', error);
        });
    });

    // console.log('Clicked on', wireframeId);
  }

  initializeEventListeners() {
    window.addEventListener('message', (e) => {
      const { data: rawData } = e as MessageEvent;

      this.initialized = true;

      const data = rawData.pluginMessage;
      if (!data) {
        return;
      }
      if (data.type === 'selectionChange') {
        this.selection = data.elements;
      }
      if (data.type === 'selectionWithImages') {
        this.selectionWithImages = data.elements;
      }
      if (data.type === 'canGetCode') {
        this.isValidImport = data.value;
      }
      if (data.type === 'doneLoading') {
        this.loading = false;
      }
      if (data.type === 'storage') {
        this.clientStorage = data.data;
      }
    });

    parent.postMessage(
      {
        pluginMessage: {
          type: 'getStorage',
        },
      },
      '*'
    );
    parent.postMessage(
      {
        pluginMessage: {
          type: 'init',
        },
      },
      '*'
    );

    // TODO: destroy on component unmount
    this.safeReaction(
      () => this.urlValue,
      () => (this.errorMessage = '')
    );
    this.selectAllUrlInputText();

    this.safeListenToEvent(window, 'offline', () => (this.online = false));
    this.safeListenToEvent(window, 'keydown', (e) => {
      this.updateKeyPositions(e as KeyboardEvent);
    });
    this.safeListenToEvent(window, 'keyup', (e) => {
      this.updateKeyPositions(e as KeyboardEvent);
    });
    this.safeListenToEvent(window, 'online', () => (this.online = true));

    this.safeReaction(
      () => this.clientStorage && fastClone(this.clientStorage),
      () => {
        if (this.clientStorage) {
          this.updateStorage();
        } else if (this.clientStorage === undefined) {
          this.clientStorage = { userId: uuid() };
        }
      }
    );

    this.safeReaction(
      () => this.clientStorage?.userId,
      (userId) => {
        if (userId) {
          amplitude.setUserId(userId);
          amplitude.track('figma plugin started');
        }
      }
    );
  }

  injectHtmlIntoIframe = () => {
    const iframe = this.iframeRef.current;
    if (iframe) {
      const iframeDoc =
        iframe.contentDocument ||
        (iframe.contentWindow && iframe.contentWindow.document);
      if (iframeDoc) {
        iframeDoc.open();
        iframeDoc.write(this.state.serializedHtml);
        iframeDoc.close();
      }
    }
  };

  handleHtmlToFigma = async () => {
    const iframe = this.iframeRef.current;
    if (iframe) {
      try {
        setContext(iframe.contentWindow as Window);
        const data = await htmlToFigmaFrame('#' + convertHtmlToLayerId);
        console.log('Figma Data:', data);
        sendToFigma(data);
      } catch (error) {
        console.error('Error converting to Figma layers:', error);
      }
    }
  };

  saveUpdates = () => {
    if (this.selection.length) {
      parent.postMessage(
        {
          pluginMessage: {
            type: 'updateElements',
            elements: fastClone(this.selection),
          },
        },
        '*'
      );
    }
  };

  componentDidUpdate(prevProps: {}, prevState: HtmlSerializerState) {
    if (prevState.serializedHtml !== this.state.serializedHtml) {
      this.injectHtmlIntoIframe();
    }
  }

  onCreate = () => {
    if (this.loading) {
      return;
    }
    if (!this.validate()) {
      if (!this.urlValid) {
        this.errorMessage = 'Please enter a valid URL';
        return;
      }
    }
    this.loading = true;
    if (this.urlValue) {
      const width = clamp(parseInt(this.width) || 1200, 200, 3000);
      const widthString = String(width);
      this.width = widthString;

      const encocedUrl = encodeURIComponent(this.urlValue);

      // We need to run the code to process DOM through a backend to run it in a headless browser.
      // Builder.io provides this for the Figma plugin for free.
      console.log(
        `${apiHost}/api/v1/url-to-figma?url=${encocedUrl}&width=${width}&useFrames=${this.useFrames}`,
        'fethc'
      );
      fetch(
        `${apiHost}/api/v1/url-to-figma?url=${encocedUrl}&width=${width}&useFrames=${this.useFrames}`
      )
        .then((res) => {
          if (!res.ok) {
            console.error('Url-to-figma failed', res);
            amplitude.track('import error');
            throw new Error('Url-to-figma failed');
          }
          amplitude.incrementUserProps('import_count');
          amplitude.track('import to figma', {
            url: this.urlValue,
            type: 'url',
          });
          // console.log(res.json(), '___res.json');
          return res.json();
        })
        .then((data) => {
          const layers = data.layers;
          console.log(layers, 'layers');
          return Promise.all(
            [data].concat(
              layers.map(async (rootLayer: Node) => {
                await traverseLayers(rootLayer, (layer: any) => {
                  if (getImageFills(layer)) {
                    return processImages(layer).catch((err) => {
                      console.warn('Could not process image', err);
                    });
                  }
                });
              })
            )
          );
        })
        .then((data) => {
          console.log(data[0], 'data[0]');
          parent.postMessage(
            { pluginMessage: { type: 'import', data: data[0] } },
            '*'
          );
        })
        .catch((err) => {
          this.loading = false;
          console.error(err);
          alert(err);
        });
    }
  };

  onCancel = () => {
    parent.postMessage({ pluginMessage: { type: 'cancel' } }, '*');
  };

  validate() {
    if (!this.form) {
      return false;
    }
    return this.form!.reportValidity();
  }

  selectAllUrlInputText() {
    const input = this.urlInputRef;
    if (input) {
      input.setSelectionRange(0, input.value.length);
    }
  }

  getLang() {
    return this.currentLanguage === 'en' ? en : ru;
  }

  switchTab = (event: any, newValue: number) => {
    this.tabIndex = newValue;
  };

  handleDevModeClick(): void {
    this.devModeClickCount++;
    if (this.devModeClickCount > 4) {
      this.showDevModeOption = true;
    }
  }
}

ReactDOM.render(
  <MuiThemeProvider theme={theme}>
    <>
      <CssBaseline />
      <App />
    </>
  </MuiThemeProvider>,
  document.getElementById('react-page')
);
