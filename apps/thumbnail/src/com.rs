//! The COM side: a thumbnail provider (IInitializeWithStream + IThumbnailProvider), its class
//! factory, and the DLL's exports, including registration for `.w3d` files.

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicIsize, Ordering};

use windows::core::{implement, Interface, Result, GUID, HRESULT, IUnknown, PCWSTR};
use windows::Win32::Foundation::{BOOL, CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, E_FAIL, E_INVALIDARG, E_POINTER, ERROR_SUCCESS, HINSTANCE, HMODULE, S_FALSE, S_OK};
use windows::Win32::Graphics::Gdi::{CreateDIBSection, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP};
use windows::Win32::Graphics::Imaging::{
    CLSID_WICImagingFactory, GUID_WICPixelFormat32bppPBGRA, IWICImagingFactory, WICBitmapInterpolationModeFant, WICConvertBitmapSource,
    WICDecodeMetadataCacheOnDemand,
};
use windows::Win32::System::Com::{CoCreateInstance, IClassFactory, IClassFactory_Impl, IStream, CLSCTX_INPROC_SERVER};
use windows::Win32::System::LibraryLoader::GetModuleFileNameW;
use windows::Win32::System::Registry::{RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ};
use windows::Win32::System::SystemServices::DLL_PROCESS_ATTACH;
use windows::Win32::UI::Shell::PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl};
use windows::Win32::UI::Shell::{IThumbnailProvider, IThumbnailProvider_Impl, SHChangeNotify, SHCreateMemStream, SHCNE_ASSOCCHANGED, SHCNF_IDLIST, WTSAT_ARGB, WTS_ALPHATYPE};

use crate::{head_is_enough, preview_png, HEAD_LIMIT};

/// This handler's class id.
pub const CLSID: GUID = GUID::from_u128(0x7541b0d3_c22f_4f87_844f_14b595fc0416);
const CLSID_TEXT: &str = "{7541B0D3-C22F-4F87-844F-14B595FC0416}";
/// IThumbnailProvider's shell extension slot.
const THUMBNAIL_SLOT: &str = "{E357FCCD-A995-4576-B01F-234630154E96}";

static MODULE: AtomicIsize = AtomicIsize::new(0);

#[implement(IInitializeWithStream, IThumbnailProvider)]
struct Provider {
    png: RefCell<Option<Vec<u8>>>,
}

impl IInitializeWithStream_Impl for Provider_Impl {
    fn Initialize(&self, pstream: Option<&IStream>, _grfmode: u32) -> Result<()> {
        let stream = pstream.ok_or(E_INVALIDARG)?;
        let mut head = Vec::new();
        let mut buf = vec![0u8; 64 * 1024];
        while head.len() < HEAD_LIMIT {
            let mut read = 0u32;
            unsafe { stream.Read(buf.as_mut_ptr() as *mut c_void, buf.len() as u32, Some(&mut read)) }.ok()?;
            if read == 0 { break }
            head.extend_from_slice(&buf[..read as usize]);
            if head_is_enough(&head) { break }
        }
        let png = preview_png(&head).ok_or(E_FAIL)?;
        *self.png.borrow_mut() = Some(png);
        Ok(())
    }
}

impl IThumbnailProvider_Impl for Provider_Impl {
    fn GetThumbnail(&self, cx: u32, phbmp: *mut HBITMAP, pdwalpha: *mut WTS_ALPHATYPE) -> Result<()> {
        if phbmp.is_null() || pdwalpha.is_null() { return Err(E_POINTER.into()) }
        let png = self.png.borrow();
        let png = png.as_deref().ok_or(E_FAIL)?;
        unsafe {
            let factory: IWICImagingFactory = CoCreateInstance(&CLSID_WICImagingFactory, None, CLSCTX_INPROC_SERVER)?;
            let mem = SHCreateMemStream(Some(png)).ok_or(E_FAIL)?;
            let decoder = factory.CreateDecoderFromStream(&mem, std::ptr::null(), WICDecodeMetadataCacheOnDemand)?;
            let frame = decoder.GetFrame(0)?;
            let (mut w, mut h) = (0u32, 0u32);
            frame.GetSize(&mut w, &mut h)?;
            if w == 0 || h == 0 { return Err(E_FAIL.into()) }
            // Fit the longer side to the size Explorer asks for.
            let k = cx.max(1) as f64 / w.max(h) as f64;
            let (tw, th) = (((w as f64 * k).round() as u32).max(1), ((h as f64 * k).round() as u32).max(1));
            let scaler = factory.CreateBitmapScaler()?;
            scaler.Initialize(&frame, tw, th, WICBitmapInterpolationModeFant)?;
            let pixels = WICConvertBitmapSource(&GUID_WICPixelFormat32bppPBGRA, &scaler)?;
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: tw as i32,
                    biHeight: -(th as i32), // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let bitmap = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)?;
            if bits.is_null() { return Err(E_FAIL.into()) }
            pixels.CopyPixels(std::ptr::null(), tw * 4, std::slice::from_raw_parts_mut(bits as *mut u8, (tw * th * 4) as usize))?;
            *phbmp = bitmap;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

#[implement(IClassFactory)]
struct Factory;

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(&self, punkouter: Option<&IUnknown>, riid: *const GUID, ppvobject: *mut *mut c_void) -> Result<()> {
        if punkouter.is_some() { return Err(CLASS_E_NOAGGREGATION.into()) }
        let unknown: IUnknown = Provider { png: RefCell::new(None) }.into();
        unsafe { unknown.query(riid, ppvobject).ok() }
    }

    fn LockServer(&self, _flock: BOOL) -> Result<()> { Ok(()) }
}

#[no_mangle]
extern "system" fn DllMain(module: HINSTANCE, reason: u32, _reserved: *mut c_void) -> BOOL {
    if reason == DLL_PROCESS_ATTACH { MODULE.store(module.0 as isize, Ordering::Relaxed) }
    BOOL(1)
}

#[no_mangle]
extern "system" fn DllGetClassObject(rclsid: *const GUID, riid: *const GUID, ppv: *mut *mut c_void) -> HRESULT {
    if rclsid.is_null() || riid.is_null() || ppv.is_null() { return E_POINTER }
    if unsafe { *rclsid } != CLSID { return CLASS_E_CLASSNOTAVAILABLE }
    let factory: IClassFactory = Factory.into();
    unsafe { factory.query(riid, ppv) }
}

#[no_mangle]
extern "system" fn DllCanUnloadNow() -> HRESULT { S_FALSE }

/// Registers the handler for `.w3d` files: machine-wide when that is allowed, else for this user.
#[no_mangle]
extern "system" fn DllRegisterServer() -> HRESULT {
    let Some(path) = module_path() else { return E_FAIL };
    let keys = [
        (format!("CLSID\\{CLSID_TEXT}"), None, "Witness 3D thumbnails".to_string()),
        (format!("CLSID\\{CLSID_TEXT}\\InprocServer32"), None, path),
        (format!("CLSID\\{CLSID_TEXT}\\InprocServer32"), Some("ThreadingModel"), "Apartment".to_string()),
        (format!(".w3d\\ShellEx\\{THUMBNAIL_SLOT}"), None, CLSID_TEXT.to_string()),
    ];
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        if keys.iter().all(|(key, name, value)| set(root, key, *name, value)) {
            unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
            return S_OK;
        }
    }
    E_FAIL
}

#[no_mangle]
extern "system" fn DllUnregisterServer() -> HRESULT {
    for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for key in [format!("Software\\Classes\\CLSID\\{CLSID_TEXT}"), format!("Software\\Classes\\.w3d\\ShellEx\\{THUMBNAIL_SLOT}")] {
            let wide = wide(&key);
            let _ = unsafe { RegDeleteTreeW(root, PCWSTR(wide.as_ptr())) };
        }
    }
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    S_OK
}

fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }

fn module_path() -> Option<String> {
    let mut buf = vec![0u16; 1024];
    let n = unsafe { GetModuleFileNameW(HMODULE(MODULE.load(Ordering::Relaxed) as *mut c_void), &mut buf) } as usize;
    (n > 0 && n < buf.len()).then(|| String::from_utf16_lossy(&buf[..n]))
}

/// Sets `name` (the default value when `None`) of `Software\Classes\<key>` under `root`.
fn set(root: HKEY, key: &str, name: Option<&str>, value: &str) -> bool {
    let path = wide(&format!("Software\\Classes\\{key}"));
    let mut handle = HKEY::default();
    let made = unsafe { RegCreateKeyExW(root, PCWSTR(path.as_ptr()), 0, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut handle, None) };
    if made != ERROR_SUCCESS { return false }
    let name = name.map(wide);
    let data: Vec<u8> = wide(value).iter().flat_map(|c| c.to_le_bytes()).collect();
    let ok = unsafe { RegSetValueExW(handle, name.as_ref().map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr())), 0, REG_SZ, Some(&data)) } == ERROR_SUCCESS;
    let _ = unsafe { RegCloseKey(handle) };
    ok
}
