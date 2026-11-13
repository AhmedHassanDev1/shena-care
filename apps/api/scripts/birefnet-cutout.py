import sys
from PIL import Image
from rembg import remove, new_session


def create_session():
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    options.enable_mem_pattern = False
    return new_session("birefnet-general", sess_opts=options)

def process_file(input_path, output_path):
    with Image.open(input_path) as original:
        img = original.copy()
    
    # Check if already transparent
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA").split()[-1]
        transparent = sum(1 for px in alpha.getdata() if px < 16)
        if transparent / (img.width * img.height) > 0.05:
            img.convert("RGBA").save(output_path, "PNG")
            return

    # Use BiRefNet general model with alpha matting
    # Let the caller record model failure and use its safe fallback.
    session = create_session()

    cutout = remove(
        img,
        session=session,
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=5
    )
    cutout.save(output_path, "PNG")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python birefnet-cutout.py <input_path> <output_path>")
        sys.exit(1)
    process_file(sys.argv[1], sys.argv[2])
