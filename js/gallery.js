/* ==========================================================================
   Jigsaw Explorer - Image Gallery & Custom Uploader Module
   ========================================================================== */

const PUZZLE_GALLERY = [
  // Default Featured Image
  {
    id: 'default-signature',
    category: 'nature',
    title: 'Featured Signature Puzzle',
    url: 'BEST_signature.svg',
    thumb: 'BEST_signature.svg'
  },

  // Nature
  {
    id: 'nature-1',
    category: 'nature',
    title: 'Alpine Mountain Lake',
    url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'nature-2',
    category: 'nature',
    title: 'Autumn Forest Trail',
    url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'nature-3',
    category: 'nature',
    title: 'Emerald Paradise Waterfall',
    url: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'nature-4',
    category: 'nature',
    title: 'Tropical Sunset Coast',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=70'
  },

  // Landmarks
  {
    id: 'landmarks-1',
    category: 'landmarks',
    title: 'Historic Castle Peak',
    url: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'landmarks-2',
    category: 'landmarks',
    title: 'Venetian Canal Sunset',
    url: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'landmarks-3',
    category: 'landmarks',
    title: 'Tokyo Neon Pagoda',
    url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=400&q=70'
  },

  // Animals
  {
    id: 'animals-1',
    category: 'animals',
    title: 'Golden Retriever Pup',
    url: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'animals-2',
    category: 'animals',
    title: 'Majestic Savanna Lion',
    url: 'https://images.unsplash.com/photo-1534188753412-3e26d0d618d6?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1534188753412-3e26d0d618d6?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'animals-3',
    category: 'animals',
    title: 'Playful Red Panda',
    url: 'https://images.unsplash.com/photo-1546182990-dffeafbe841d?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1546182990-dffeafbe841d?auto=format&fit=crop&w=400&q=70'
  },

  // Art & Fantasy
  {
    id: 'art-1',
    category: 'art',
    title: 'Watercolor Blossom Valley',
    url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'art-2',
    category: 'art',
    title: 'Vibrant Abstract Waves',
    url: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1541701494587-cb58502866ab?auto=format&fit=crop&w=400&q=70'
  },

  // Cosmos & Space
  {
    id: 'space-1',
    category: 'space',
    title: 'Cosmic Nebula & Stars',
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=400&q=70'
  },
  {
    id: 'space-2',
    category: 'space',
    title: 'Aurora Borealis Lights',
    url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?auto=format&fit=crop&w=1400&q=80',
    thumb: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?auto=format&fit=crop&w=400&q=70'
  }
];

class GalleryManager {
  constructor(onSelectCallback) {
    this.onSelect = onSelectCallback;
    this.activeCategory = 'nature';
    this.gridEl = document.getElementById('galleryGrid');
    this.tabsEl = document.querySelectorAll('.tab-btn');
    
    this.init();
  }

  init() {
    this.tabsEl.forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.tabsEl.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeCategory = tab.dataset.category;
        this.renderCategory(this.activeCategory);
      });
    });

    this.renderCategory(this.activeCategory);
    this.setupUploader();
  }

  renderCategory(category) {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';

    const items = PUZZLE_GALLERY.filter(item => item.category === category);
    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'gallery-card';
      card.innerHTML = `
        <img src="${item.thumb}" alt="${item.title}" loading="lazy">
        <div class="gallery-card-overlay">
          <span class="gallery-card-title">${item.title}</span>
        </div>
      `;
      card.addEventListener('click', () => {
        if (this.onSelect) {
          this.onSelect(item.url, item.title);
        }
      });
      this.gridEl.appendChild(card);
    });
  }

  setupUploader() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const urlInput = document.getElementById('imageUrlInput');
    const btnLoadUrl = document.getElementById('btnLoadUrl');

    if (dropZone) {
      ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('dragover');
        });
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('dragover');
        });
      });

      dropZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
          this.handleFile(files[0]);
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.handleFile(e.target.files[0]);
        }
      });
    }

    if (btnLoadUrl && urlInput) {
      btnLoadUrl.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url) {
          if (this.onSelect) {
            this.onSelect(url, 'Custom Web Image');
          }
        }
      });
    }
  }

  handleFile(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file (JPG, PNG, WebP, SVG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (this.onSelect) {
        this.onSelect(e.target.result, file.name.replace(/\.[^/.]+$/, ''));
      }
    };
    reader.readAsDataURL(file);
  }

  getRandomNextImage(currentUrl) {
    const available = PUZZLE_GALLERY.filter(i => i.url !== currentUrl);
    const item = available[Math.floor(Math.random() * available.length)] || PUZZLE_GALLERY[0];
    return item;
  }
}
