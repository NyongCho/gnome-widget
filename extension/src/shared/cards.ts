export const CARD_IDS=['clock','calendar','weather','agenda','network','system','media'] as const;
export type CardId=typeof CARD_IDS[number];
export function normalizeCardOrder(order:readonly string[]):CardId[]{
    const known=new Set<string>(CARD_IDS);
    return [...new Set([...order,...CARD_IDS])].filter((id):id is CardId=>known.has(id));
}
export function orderedVisibleCards(order:readonly string[],visible:readonly string[]):CardId[]{
    const enabled=new Set(visible);
    return normalizeCardOrder(order).filter(id=>enabled.has(id));
}
export function moveCard(order:readonly string[],id:CardId,direction:-1|1):CardId[]{
    const result=normalizeCardOrder(order),from=result.indexOf(id),to=from+direction;
    if(to>=0&&to<result.length)[result[from],result[to]]=[result[to]!,result[from]!];
    return result;
}
