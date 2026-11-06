import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export async function selectFixture(directory,name){
    // Existing-file atomic replacement may fsync; keep it off the Shell thread.
    const bytes=new GLib.Bytes(new TextEncoder().encode(name));
    await new Promise((resolve,reject)=>Gio.File.new_for_path(`${directory}/selection.txt`)
        .replace_contents_bytes_async(bytes,null,false,Gio.FileCreateFlags.REPLACE_DESTINATION,null,
            (file,result)=>{try{file.replace_contents_finish(result);resolve();}catch(error){reject(error);}}));
}
