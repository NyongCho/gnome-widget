import {DataFailure} from '../data/errors.js';
/** Pending registrations count against limits and die with their original sender. */
export class CalendarTokens {
    private tokens=new Map<string,string>();private pending=new Map<object,string>();private dead=false;
    constructor(private uuid:()=>string,private demand:(count:number)=>void){}
    get size():number{return this.tokens.size;}
    begin(sender:string):{commit():string|null;cancel():void}{
        if(this.dead)throw new DataFailure('SERVICE_UNAVAILABLE');
        if(sender.length>255||!/^:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(sender))throw new DataFailure('INVALID_DATA');
        const used=[...this.tokens.values(),...this.pending.values()];if(used.length>=128||used.filter(s=>s===sender).length>=8)throw new DataFailure('RATE_LIMITED');
        const key={};this.pending.set(key,sender);
        return{commit:()=>{if(this.dead||!this.pending.delete(key))return null;const token=this.uuid();this.tokens.set(token,sender);this.demand(this.tokens.size);return token;},cancel:()=>{this.pending.delete(key);}};
    }
    unwatch(sender:string,token:string):void{if(this.tokens.get(token)!==sender)return;this.tokens.delete(token);this.demand(this.tokens.size);}
    senderGone(sender:string):void{const before=this.tokens.size;for(const[token,owner]of this.tokens)if(owner===sender)this.tokens.delete(token);for(const[key,owner]of this.pending)if(owner===sender)this.pending.delete(key);if(before!==this.tokens.size)this.demand(this.tokens.size);}
    destroy():void{if(this.dead)return;this.dead=true;this.pending.clear();this.tokens.clear();this.demand(0);}
}
