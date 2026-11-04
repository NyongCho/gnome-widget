import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {normalizeCardColumns,type CardColumns} from './shared/cards.js';
/** Both columns are one setting so transfers cannot expose an intermediate duplicate or missing card. */
export function saveCardColumns(settings:Gio.Settings,columns:CardColumns):void{
    const normalized=normalizeCardColumns(columns),next=[normalized.left,normalized.right];
    if(JSON.stringify(settings.get_value('card-columns').deep_unpack())!==JSON.stringify(next))settings.set_value('card-columns',new GLib.Variant('aas',next));
}
export function initializeCardColumns(settings:Gio.Settings):CardColumns{
    const raw=settings.get_value('card-columns').deep_unpack() as string[][];
    const columns=normalizeCardColumns({left:raw[0]??[],right:raw[1]??[]});
    saveCardColumns(settings,columns);return columns;
}
