import type Gio from 'gi://Gio';
import {normalizeCardOrder,type CardId} from './shared/cards.js';
/** Seed the separate order once, preserving the existing enabled-card sequence. */
export function initializeCardOrder(settings:Gio.Settings):CardId[]{
    const stored=settings.get_strv('card-order');
    const order=normalizeCardOrder(stored.length?stored:settings.get_strv('visible'));
    if(stored.length!==order.length||stored.some((id,index)=>id!==order[index]))settings.set_strv('card-order',order);
    return order;
}
