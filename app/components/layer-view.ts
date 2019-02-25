
import { View } from 'ui/core/view'
import { Color } from 'color'
import { GridLayout, ItemSpec } from 'ui/layouts/grid-layout';
import { Label } from 'ui/label';
import { Button } from 'ui/button';
import { Progress } from 'ui/progress';
import { ArgonWebView } from 'argon-web-view';
import { PropertyChangeData, WrappedValue, EventData } from 'data/observable';
// import { layout } from 'utils/utils'
import * as gradient from 'nativescript-gradient'
import { appModel, XRLayerDetails, BookmarkItem, XRImmersiveMode } from '../app-model'
import { useTransformsWithoutChangingSafeArea } from '../utils'
import { observable } from '../decorators'
import * as application from 'application'
import * as fileSystem from 'file-system'
import * as vuforia from 'nativescript-vuforia'
// import { FullscreenLayout } from './fullscreen-layout'


export const TITLE_BAR_HEIGHT = 30;

export interface XRHitTestData extends EventData {
    options: {
        x:number
        y:number
    },
    result?:Promise<XRHitResult>
}

export interface XRCreateHitAnchorData extends EventData {
    options: {
        id:string
    },
    result?:Promise<void>
}

export interface XRCreateMidAirAnchorData extends EventData {
    options: {
        transform:Array<number>
    },
    result?:Promise<{id:string}>
}

export interface XRHitResult {
    id: string
    transform: Array<number>
}

export interface LayerView {
    on(eventNames: string, callback: (data: EventData) => void, thisArg?: any);
    on(event: "xrHitTest", callback: (data: XRHitTestData) => void, thisArg?: any);
    on(event: "xrCreateHitAnchor", callback: (data: XRCreateHitAnchorData) => void, thisArg?: any);
    on(event: "xrCreateMidAirAnchor", callback: (data: XRCreateMidAirAnchorData) => void, thisArg?: any);
}

const WEBXR_FILE = fileSystem.knownFolders.currentApp().getFile('js/webxr-polyfill.js')
let WEBXR_SOURCE = WEBXR_FILE.readTextSync()
let WEBXR_LAST_MODIFIED = WEBXR_FILE.lastModified

export class LayerView extends GridLayout {
    
    webView: ArgonWebView
    contentView: GridLayout
    touchOverlay: View
    titleBar: GridLayout
    closeButton: Button
    titleLabel: Label
    progressBar: Progress

    visualIndex = 0

    @observable({type:XRLayerDetails})
    details: XRLayerDetails

    constructor(details: XRLayerDetails) {
        super()

        useTransformsWithoutChangingSafeArea(this)
        this.clipToBounds = true
        this.opacity = 0

        const webView = new ArgonWebView() 

        if (WEBXR_FILE.lastModified.getTime() > WEBXR_LAST_MODIFIED.getTime()) {
            WEBXR_LAST_MODIFIED = WEBXR_FILE.lastModified
            WEBXR_SOURCE = WEBXR_FILE.readTextSync()
        }

        if (webView.ios) {
            const wkWebView = webView.ios as WKWebView
            const userScript = WKUserScript.alloc()
                .initWithSourceInjectionTimeForMainFrameOnly(WEBXR_SOURCE, WKUserScriptInjectionTime.AtDocumentStart, true)
            wkWebView.configuration.userContentController.addUserScript(userScript)
        } else if (webView.android) {
            // TODO: inject WebXR
        }

        webView.on('urlChange', () => {
            let uri = webView!.url || ''
            if (uri === 'about:blank') uri = ''
            this.details.content = new BookmarkItem({uri})
        })

        webView.on('loadStarted', () => {
            this.details.onLoadStarted()
        })

        webView.messageHandlers['xr.start'] = () => {
            this.details.xrEnabled = true
        }

        webView.messageHandlers['xr.stop'] = () => {
            this.details.xrEnabled = true
        }
        
        webView.messageHandlers['xr.setImmersiveMode'] = (options:{mode:XRImmersiveMode}) => {
            this.details.xrImmersiveMode = options.mode
        }

        webView.messageHandlers['xr.averageCPUTime'] = (options:{time:number}) => {
            this.details.xrAverageCPUTime = options.time
        }

        webView.messageHandlers['xr.hitTest'] = (options:{x:number,y:number}) => {
            const evt:XRHitTestData = {
                eventName:'xrHitTest', 
                object:this,
                options,
                result:undefined
            }
            this.notify(evt)
            if (evt.result) return Promise.resolve(evt.result)
            else return Promise.reject()
        }

        webView.messageHandlers['xr.createHitAnchor'] = (options:{id:string}) => {
            const evt:XRCreateHitAnchorData = {
                eventName:'xrCreateHitAnchor', 
                object:this,
                options,
                result:undefined
            }
            this.notify(evt)
            if (evt.result) return Promise.resolve(evt.result)
            else return Promise.reject()
        }

        webView.messageHandlers['xr.createMidAirAnchor'] = (options:{transform:Array<number>}) => {
            const evt:XRCreateMidAirAnchorData = {
                eventName:'xrCreateMidAirAnchor', 
                object:this,
                options,
                result:undefined
            }
            this.notify(evt)
            if (evt.result) return Promise.resolve(evt.result)
            else return Promise.reject()
        }


        if (webView.ios) {
            // animate any changes to webview content due to safe area changes
            webView.ios.addObserverForKeyPathOptionsContext(new class SafeAreaObserver extends NSObject {
                observeValueForKeyPathOfObjectChangeContext(keyPath, object, change) {
                    UIView.animateWithDurationAnimations(0.3, ()=>{
                        webView.ios.layoutIfNeeded()
                    })
                }
            }, 'safeAreaInsets', NSKeyValueObservingOptions.Initial, <any>null)
        }

        const contentView = new GridLayout();

        // Cover the webview to detect gestures and disable interaction
        const touchOverlay = new gradient['Gradient']();
        touchOverlay.on('loaded', () => {
            (touchOverlay as any).updateDirection('to bottom');
            (touchOverlay as any).updateColors([new Color('transparent'), new Color('rgba(0,0,0,0.6)')]);
            // insert layer manually until this package works with Nativescript 3.0
            (touchOverlay.ios.layer as CALayer).insertSublayerAtIndex(touchOverlay._gradientLayer, 0); 
        })
        touchOverlay.isUserInteractionEnabled = false;
        touchOverlay.opacity = 0;

        const titleBar = new GridLayout();
        titleBar.iosOverflowSafeAreaEnabled = true
        titleBar.addRow(new ItemSpec(TITLE_BAR_HEIGHT, 'pixel'));
        titleBar.addColumn(new ItemSpec(TITLE_BAR_HEIGHT, 'pixel'));
        titleBar.addColumn(new ItemSpec(1, 'star'));
        titleBar.addColumn(new ItemSpec(TITLE_BAR_HEIGHT, 'pixel'));
        titleBar.verticalAlignment = 'top';
        titleBar.horizontalAlignment = 'stretch';
        titleBar.backgroundColor = new Color(200, 255, 255, 255);
        titleBar.opacity = 0;

        const closeButton = new Button();
        closeButton.horizontalAlignment = 'stretch';
        closeButton.verticalAlignment = 'stretch';
        closeButton.text = 'close';
        closeButton.className = 'material-icon action-btn';
        closeButton.style.fontSize = application.android ? 16 : 22;
        closeButton.color = new Color('black');
        GridLayout.setRow(closeButton, 0);
        GridLayout.setColumn(closeButton, 0);

        const titleLabel = new Label();
        titleLabel.iosOverflowSafeAreaEnabled = true
        titleLabel.horizontalAlignment = 'stretch';
        titleLabel.verticalAlignment = application.android ? 'middle' : 'stretch';
        titleLabel.textAlignment = 'center';
        titleLabel.color = new Color('transparent');
        titleLabel.fontSize = 14;
        GridLayout.setRow(titleLabel, 0);
        GridLayout.setColumn(titleLabel, 1);

        titleBar.addChild(closeButton);
        titleBar.addChild(titleLabel);;

        var progressBar = new Progress();
        progressBar.className = 'progress';
        progressBar.verticalAlignment = 'top';
        progressBar.maxValue = 100;
        progressBar.height = 5;
        progressBar.visibility = 'collapse';

        this.addChild(contentView);
        this.addChild(titleBar);
        contentView.addChild(progressBar);
        contentView.addChild(webView);
        contentView.addChild(touchOverlay)
        
        Object.assign(this, {
            webView,
            contentView,
            touchOverlay,
            titleBar,
            closeButton,
            titleLabel,
            progressBar
        })

        appModel.on('propertyChange', (evt: PropertyChangeData) => {
            switch (evt.propertyName) {
                case 'safeAreaInsets':
                case 'screenSize':
                    this._updateUI() 
                    break
            }
        })

        this.on('propertyChange', (evt: PropertyChangeData) => {
            switch (evt.propertyName) {
                case 'details.src': {
                    const src = this.details.src || 'about:blank'
                    if (src !== BookmarkItem.REALITY_LIVE.uri) {
                        webView.src = src !== webView.src ? src : <any>new WrappedValue(src)
                    }
                    break
                }
                case 'details.xrImmersiveMode':
                case 'details.content.title': 
                case 'details.content.uri': {
                    this._updateUI()
                    break
                }
            }
        })

        this.on('loaded', () => {
            this._updateUI()
        })

        this.details = details
        this.details.log = webView.log
        this._updateUI()
    }

    private _updateUI() {

        if (!this.isLoaded) return

        const size = appModel.screenSize
        this.width = size.width
        this.height = size.height

        // update title bar
        const title = this.details.content ? this.details.content.title : ''

        if (this.details.xrImmersiveMode === 'reality') {
            this.titleBar.backgroundColor = new Color(0xFF222222);
            this.titleLabel.color = new Color('white');        
            this.titleLabel.text = title ? 'Reality: ' + title : 'Reality'
            this.closeButton.color = new Color('white')
        } else {
            this.titleBar.backgroundColor = new Color('white');
            this.titleLabel.color = new Color('black');
            this.titleLabel.text = title
            this.closeButton.color = new Color('black')
        }
        
        // update webview 

        const transparent = this.details.xrEnabled && this.details.xrImmersiveMode !== 'none'

        if (this.webView.ios) {
            const wkWebView = this.webView.ios as WKWebView
            const transparentColor = UIColor.colorWithCIColor(CIColor.clearColor)
            const whiteColor = UIColor.colorWithCIColor(CIColor.whiteColor)
            const color = transparent ? transparentColor : whiteColor;
            wkWebView.opaque = !transparent
            wkWebView.scrollView.opaque = !transparent
            wkWebView.scrollView.backgroundColor = color
            wkWebView.backgroundColor = color  
        }

        if (this.webView.android) {
            const androidWebView = this.webView.android as android.webkit.WebView
            const color = transparent ? android.graphics.Color.TRANSPARENT : android.graphics.Color.WHITE
            androidWebView['setBackgroundColor'](color)
        }

        // update webview or video visibility
        
        const uri = this.details.content.uri
        if (uri === BookmarkItem.REALITY_LIVE.uri || uri == 'about:blank' || uri === '') {
            this.webView.visibility = 'collapse'
            if (uri.toLowerCase() === BookmarkItem.REALITY_LIVE.uri) {
                if (vuforia.videoView.parent)
                    (vuforia.videoView.parent as GridLayout).removeChild(vuforia.videoView)
                this.contentView.insertChild(vuforia.videoView, 0)
            }
        } else {
            this.webView.visibility = 'visible'
        }
    }
}