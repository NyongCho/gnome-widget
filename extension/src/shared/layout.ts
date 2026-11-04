import {DEFAULT_CARD_COLUMNS,visibleCardColumns,type CardColumns} from './cards.js';
export interface Rect{x:number;y:number;width:number;height:number}
export interface LayoutConfig{monitor:string;anchor:'top-right'|'top-left';offsetX:number;offsetY:number;scale:number;visible:string[];cardColumns?:CardColumns}
export interface LayoutResult{cards:{id:string;rect:Rect}[];columns:1|2;overflow:boolean;viewport:Rect;toolbarHeight:number;contentHeight:number}
const heights:Record<string,number>={clock:142,calendar:252,weather:230,agenda:210,network:210,system:174,media:174};
// Measurements are logical screen pixels and already include the UI scale.
export function computeLayout(config:LayoutConfig,area:Rect,visible:string[],measuredHeights:Readonly<Record<string,number>>={}):LayoutResult{
    const scale=Math.max(.75,Math.min(1.5,Number.isFinite(config.scale)?config.scale:1));
    const marginX=Math.min(Math.max(0,config.offsetX),Math.max(0,area.width*.08));
    const marginY=Math.min(Math.max(0,config.offsetY),Math.max(0,area.height*.08));
    const availableWidth=Math.max(1,area.width-2*marginX);
    const gap=14*scale,toolbarHeight=Math.min(40*scale,Math.max(1,area.height/3));
    const columns:1|2=availableWidth>=478*scale?2:1;
    const width=columns===2?478*scale:Math.min(320*scale,availableWidth);
    const cardWidth=(width-(columns-1)*gap)/columns;
    const lists=visibleCardColumns(config.cardColumns??DEFAULT_CARD_COLUMNS,visible);
    const naturalHeight=(id:string)=>{
        const measured=measuredHeights[id];
        return measured!==undefined&&Number.isFinite(measured)&&measured>0?measured:heights[id]!*scale;
    };
    const clockHeight=Math.max(naturalHeight('clock'),visible.includes('weather')?naturalHeight('weather'):230*scale);
    const cards:LayoutResult['cards']=[];
    const stacks=columns===2?[lists.left,lists.right]:[[...lists.left,...lists.right]];
    const stackHeights=stacks.map((ids,column)=>{
        let y=0;
        for(const id of ids){
            const height=id==='clock'?clockHeight:naturalHeight(id);
            cards.push({id,rect:{x:column*(cardWidth+gap),y,width:cardWidth,height}});y+=height+gap;
        }
        return ids.length?y-gap:0;
    });
    const contentHeight=Math.max(...stackHeights);
    const height=Math.min(toolbarHeight+contentHeight,Math.max(toolbarHeight+1,area.height-2*marginY));
    return{cards,columns,overflow:contentHeight>height-toolbarHeight,contentHeight,toolbarHeight,
        viewport:{x:config.anchor==='top-right'?area.x+area.width-marginX-width:area.x+marginX,y:area.y+marginY,width,height}};
}
export function selectMonitor(selected:string,monitors:{id:string;primary:boolean}[]):number{
    const found=monitors.findIndex(m=>m.id===selected);
    return found>=0?found:monitors.length?Math.max(0,monitors.findIndex(m=>m.primary)):-1;
}
