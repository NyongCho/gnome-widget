import type {Cancellation} from '../shared/dataClient.js';
export interface PrivateFiles {
    read(name:string,maxBytes:number,cancel:Cancellation):Promise<Uint8Array|null>;
    replace(name:string,bytes:Uint8Array,cancel:Cancellation):Promise<void>;
    remove(name:string,cancel:Cancellation):Promise<void>;
}
export interface SecretStore {
    lookup(sourceId:string,cancel:Cancellation):Promise<string|null>;
    save(sourceId:string,url:string,cancel:Cancellation):Promise<void>;
    remove(sourceId:string,cancel:Cancellation):Promise<void>;
    clearAll(cancel:Cancellation):Promise<void>;
}
export interface HttpClient {get(url:string,limits:{maxBytes:number;timeoutMs:number},cancel:Cancellation):Promise<Uint8Array>}
