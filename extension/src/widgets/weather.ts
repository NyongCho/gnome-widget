import St from 'gi://St';
import Clutter from 'gi://Clutter';
import type {WeatherData} from '../types.js';
import {weatherView} from '../shared/weatherFormat.js';
import {GlassCard,label} from './card.js';
export function renderWeather(card:GlassCard,data:WeatherData,scale:number,locale:string,hour12:boolean):void{
    card.title.set_text(data.location);const view=weatherView(data,locale,hour12);
    if(!view){card.body.add_child(label('날씨 시간대를 확인해 주세요'));return;}
    const current=new St.BoxLayout({x_expand:true});current.add_child(label(view.temperature,'liquid-big'));
    current.add_child(new St.Icon({icon_name:view.icon,icon_size:Math.round(32*scale),y_align:Clutter.ActorAlign.CENTER}));card.body.add_child(current);
    card.body.add_child(label(view.description));
    const hours=new St.BoxLayout({x_expand:true});
    for(const hour of view.hours){const column=new St.BoxLayout({orientation:Clutter.Orientation.VERTICAL,width:Math.max(1,(card.button.width-36*scale)/6)});
        column.add_child(label(hour.time,'liquid-weather-hour'));column.add_child(label(hour.temperature,'liquid-weather-temperature'));column.add_child(label(hour.rain,'liquid-weather-rain'));hours.add_child(column);}
    card.body.add_child(hours);card.body.add_child(label('Open-Meteo','liquid-weather-attribution'));
}
