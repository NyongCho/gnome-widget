export const CARD_IDS=['clock','calendar','weather','agenda','network','system','media'] as const;
export type CardId=typeof CARD_IDS[number];
export type CardSide='left'|'right';
export interface CardColumns{left:CardId[];right:CardId[]}
type ColumnInput={left:readonly string[];right:readonly string[]};
export const DEFAULT_CARD_COLUMNS={left:['clock','calendar','agenda'],right:['weather','system','network','media']} as const;
const sides=['left','right'] as const;
export function normalizeCardColumns(columns:ColumnInput):CardColumns{
    const result:CardColumns={left:[],right:[]},known=new Set<string>(CARD_IDS),seen=new Set<string>();
    for(const side of sides)for(const id of columns[side]){
        if(known.has(id)&&!seen.has(id)){result[side].push(id as CardId);seen.add(id);}
    }
    for(const side of sides)for(const id of DEFAULT_CARD_COLUMNS[side])if(!seen.has(id)){result[side].push(id);seen.add(id);}
    return result;
}
export function visibleCardColumns(columns:ColumnInput,visible:readonly string[]):CardColumns{
    const result=normalizeCardColumns(columns),enabled=new Set(visible);
    return {left:result.left.filter(id=>enabled.has(id)),right:result.right.filter(id=>enabled.has(id))};
}
export function moveCard(columns:CardColumns,id:CardId,direction:-1|1):CardColumns{
    const result=normalizeCardColumns(columns),side=result.left.includes(id)?'left':'right';
    const from=result[side].indexOf(id),to=from+direction;
    if(to>=0&&to<result[side].length)[result[side][from],result[side][to]]=[result[side][to]!,result[side][from]!];
    return result;
}
export function transferCard(columns:CardColumns,id:CardId,target:CardSide):CardColumns{
    const result=normalizeCardColumns(columns);
    if(result[target].includes(id))return result;
    const origin=target==='left'?'right':'left';
    result[origin]=result[origin].filter(value=>value!==id);result[target].push(id);
    return result;
}
