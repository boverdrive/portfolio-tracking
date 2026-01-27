import sys
from PIL import Image, ImageDraw, ImageFont

def create_icon(path):
    size = (1024, 1024)
    # Gradient-ish background (solid for simplicity in this script, or simple gradient)
    # Emerald green #22c55e to Teal #14b8a6
    # Let's just do a solid emerald green for now to be safe and simple
    color = (34, 197, 94) # #22c55e
    
    img = Image.new('RGBA', size, color)
    draw = ImageDraw.Draw(img)
    
    # Draw simple "PT" text if possible, or just a shape
    # Since we might not have fonts, let's draw a white rounded rectangle or circle/text
    # Draw a white circle in the middle
    center = (512, 512)
    radius = 300
    draw.ellipse((center[0]-radius, center[1]-radius, center[0]+radius, center[1]+radius), fill='white')
    
    # Save as PNG
    img.save(path, 'PNG')
    print(f"Created {path}")

if __name__ == "__main__":
    create_icon("app-icon.png")
