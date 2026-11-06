import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {fillSettingsWindow} from './prefs/pages.js';
export default class Preferences extends ExtensionPreferences {
    async fillPreferencesWindow(window:Adw.PreferencesWindow):Promise<void>{fillSettingsWindow(window,this.getSettings(),this.path);}
}
