import * as def from 'argon-web-view'
import {WebView} from 'ui/web-view'
import * as Argon from 'argon'

export abstract class ArgonWebView extends WebView implements def.ArgonWebView {
    
    public static sessionUrlMap = new WeakMap<Argon.SessionPort, string>();
    
    public static sessionConnectEvent = 'sessionConnect';
    public static logEvent = 'log';

    public abstract get progress() : number;

    public session:Argon.SessionPort;
    private _sessionMessagePort:Argon.MessagePortLike;

    public log:string[] = [];

    public _handleArgonMessage(message:string) {
        if (typeof this._sessionMessagePort == 'undefined') { 
            // note: this.src is what the webview was originally set to load, this.url is the actual current url. 
            const sessionUrl = this.url;
            
            console.log('Connecting to argon.js application at ' + sessionUrl);
            const manager = Argon.ArgonSystem.instance;
            const messageChannel = manager.session.createSynchronousMessageChannel();
            const remoteSession = manager.session.addManagedSessionPort();
            ArgonWebView.sessionUrlMap.set(remoteSession, sessionUrl);
            
            this._sessionMessagePort = messageChannel.port2;
            this._sessionMessagePort.onmessage = (msg:Argon.MessageEventLike) => {
                if (!this.session) return;
                const injectedMessage = "__ARGON_PORT__.postMessage("+JSON.stringify(msg.data)+")";
                this.evaluateJavascript(injectedMessage);
            }

            remoteSession.connectEvent.addEventListener(()=>{
                remoteSession.info.name = sessionUrl;
                this.session = remoteSession;
                const args:def.SessionConnectEventData = {
                    eventName: ArgonWebView.sessionConnectEvent,
                    object: this,
                    session: remoteSession
                }
                this.notify(args);
            });

            remoteSession.closeEvent.addEventListener(()=>{
                if (this.session === remoteSession) {
                    this._sessionMessagePort = undefined;
                    this.session = null;
                }
            })

            remoteSession.open(messageChannel.port1, manager.session.configuration);
        }
        console.log(message);
        this._sessionMessagePort.postMessage(JSON.parse(message));
    }

    public _handleLogMessage(message:string) {
        const logMessage = this.url + ': ' + message;
        console.log(logMessage); 
        this.log.push(logMessage);
        const args:def.LogEventData = {
            eventName: ArgonWebView.logEvent,
            object:this,
            message: logMessage
        }
        this.notify(args);
    }

    public abstract evaluateJavascript(script:string) : Promise<any>;

    public abstract bringToFront();

}
