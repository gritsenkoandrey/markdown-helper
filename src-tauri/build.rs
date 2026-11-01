fn main() {
    // Иконка вшивается в exe при сборке, но tauri-build не просит cargo следить за папкой icons:
    // без этой строки замена иконки не попадала в новую сборку.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
