import editions from '../editions.json' with {type:'json'};
export type EditionName='rust'|'gjs';
export interface Edition {
    backend:EditionName;uuid:string;schemaId:string;schemaPath:string;
    dataDirectory:string;secretApplication:string;output:string;homepage:string;
}
export function getEdition(name:string):Edition {
    if(name!=='rust'&&name!=='gjs')throw new Error('Unknown edition');
    return editions[name] as Edition;
}
declare const __LIQUID_EDITION__:Edition;
export const EDITION:Edition=typeof __LIQUID_EDITION__==='undefined'?getEdition('rust'):__LIQUID_EDITION__;
