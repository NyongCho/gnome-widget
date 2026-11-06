import type {Cancellation} from '../shared/dataClient.js';
import {parseCalendarSummary,type CalendarSummary} from '../shared/calendarSummary.js';
import {DataFailure} from '../data/errors.js';
export interface StatusTransport {
    watchOwner(changed:(owner:string|null)=>void):()=>void;
    watchChanges(owner:string,changed:(raw:string)=>void):()=>void;
    call(owner:string,method:string,args:readonly unknown[],cancel:Cancellation|null):Promise<readonly unknown[]>;
}
interface Attachment {owner:string;active:boolean;token:string|null;unwatch:()=>void;instance:string|null;last:CalendarSummary|null;pending:CalendarSummary|null}
const sameContext=(a:CalendarSummary['context'],b:CalendarSummary['context'])=>a===null||b===null?a===b:a.month===b.month&&a.timeZone===b.timeZone&&a.weekStart===b.weekStart;
const tokenValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
/** Watches signals before the side-effecting call; its reply always gets drained. */
export class CalendarStatusClient {
    private dead=false;private ownerWatch:(()=>void)|null=null;private attachment:Attachment|null=null;
    constructor(private wire:StatusTransport,private changed:(state:CalendarSummary)=>void,private ownerChanged:(owner:string|null)=>void,private failed:()=>void=()=>{}){}
    start():void{if(this.dead||this.ownerWatch)return;this.ownerWatch=this.wire.watchOwner(owner=>this.attach(owner));}
    private release(owner:string,token:string):void{void this.wire.call(owner,'UnwatchCalendar',[token],null).catch(()=>{});}
    private detach():void{const old=this.attachment;this.attachment=null;if(old){old.active=false;old.unwatch();if(old.token)this.release(old.owner,old.token);}}
    private accept(a:Attachment,state:CalendarSummary):void{
        if(!a.active||this.attachment!==a||state.instanceId!==a.instance)return;
        if(a.last&&(state.revision<=a.last.revision||state.generation<a.last.generation||state.generation===a.last.generation&&(state.sourceId!==a.last.sourceId||!sameContext(state.context,a.last.context))))return;
        a.last=state;this.changed(state);
    }
    private attach(owner:string|null):void{
        if(this.dead)return;this.detach();this.ownerChanged(owner);if(!owner)return;
        const a:Attachment={owner,active:true,token:null,unwatch:()=>{},instance:null,last:null,pending:null};this.attachment=a;
        a.unwatch=this.wire.watchChanges(owner,raw=>{
            if(!a.active)return;let state:CalendarSummary;try{state=parseCalendarSummary(raw);}catch{return;}
            if(a.instance===null){if(!a.pending||a.pending.instanceId!==state.instanceId||state.revision>a.pending.revision)a.pending=state;}
            else this.accept(a,state);
        });
        // Never cancel this call on close/owner change: it may have created a token.
        void this.wire.call(owner,'WatchCalendar',[],null).then(reply=>{
            const token=reply[0];if(!tokenValid(token)){if(a.active)this.failed();return;}
            if(!a.active||this.attachment!==a){this.release(owner,token);return;}
            let snapshot:CalendarSummary;try{if(reply.length!==2||typeof reply[1]!=='string')throw new Error();snapshot=parseCalendarSummary(reply[1]);}
            catch{this.release(owner,token);this.failed();return;}
            a.token=token;a.instance=snapshot.instanceId;
            const pending=a.pending;a.pending=null;
            this.accept(a,pending&&pending.instanceId===snapshot.instanceId&&pending.revision>snapshot.revision?pending:snapshot);
        },()=>{if(a.active)this.failed();});
    }
    async refresh(cancel:Cancellation):Promise<void>{const owner=this.attachment?.owner;if(this.dead||!owner)throw new DataFailure('SERVICE_UNAVAILABLE');await this.wire.call(owner,'RefreshCalendar',[],cancel);}
    stop():void{this.ownerWatch?.();this.ownerWatch=null;this.detach();}
    destroy():void{if(this.dead)return;this.dead=true;this.stop();}
}
