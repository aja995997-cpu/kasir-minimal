const { createApp, ref, onMounted, computed, nextTick } = Vue;

const app = createApp({
    setup() {
        // --- DATABASE SETUP (DEXIE.JS) ---
        const db = new Dexie("ZafPOS_DB");
        db.version(1).stores({
            products: "++id, name, price, stock, &barcode",
            transactions: "++id, total, date"
        });

        // --- STATE / REACTIVE VARS ---
        const activeTab = ref('pos');
        const dbStatus = ref('Online Mode');
        const products = ref([]);
        const transactions = ref([]);
        const cart = ref([]);
        const isScanning = ref(false);
        const showAddProduct = ref(false);
        const newProd = ref({ name: '', price: 0, stock: 0, barcode: '' });

        // --- SCANNER INSTANCE ---
        let codeReader = null;

        // --- COMPUTED ---
        const cartTotal = computed(() => cart.value.reduce((acc, item) => acc + (item.price * item.qty), 0));

        // --- METHODS ---
        const loadData = async () => {
            products.value = await db.products.toArray();
            transactions.value = await db.transactions.orderBy('date').reverse().toArray();
            renderAllBarcodes();
        };

        const renderAllBarcodes = () => {
            nextTick(() => {
                products.value.forEach(p => {
                    const el = document.querySelector(`#bc-${p.barcode}`);
                    if (el) JsBarcode(`#bc-${p.barcode}`, p.barcode, { height: 30, fontSize: 10 });
                });
            });
        };

        const saveProduct = async () => {
            if (!newProd.value.name) return alert("Nama produk wajib diisi");
            if (!newProd.value.barcode) newProd.value.barcode = Date.now().toString().slice(-8);
            
            try {
                await db.products.add({ ...newProd.value });
                newProd.value = { name: '', price: 0, stock: 0, barcode: '' };
                showAddProduct.value = false;
                await loadData();
            } catch (e) {
                alert("Gagal simpan: Barcode mungkin sudah ada");
            }
        };

        const addToCart = (product) => {
            const existing = cart.value.find(i => i.id === product.id);
            if (existing) {
                existing.qty++;
            } else {
                cart.value.push({ ...product, qty: 1 });
            }
        };

        const updateQty = (item, change) => {
            const index = cart.value.findIndex(i => i.id === item.id);
            if (index !== -1) {
                cart.value[index].qty += change;
                if (cart.value[index].qty <= 0) cart.value.splice(index, 1);
            }
        };

        const checkout = async () => {
            if (cart.value.length === 0) return;
            const trx = {
                items: JSON.parse(JSON.stringify(cart.value)),
                total: cartTotal.value,
                date: new Date()
            };
            
            await db.transactions.add(trx);
            for (const item of cart.value) {
                await db.products.where('id').equals(item.id).modify(p => p.stock -= item.qty);
            }
            
            cart.value = [];
            alert("Transaksi Berhasil!");
            await loadData();
        };

        // --- SCANNER LOGIC (FIXED) ---
        const startScanner = async () => {
            isScanning.value = true;
            
            try {
                if (!codeReader) {
                    codeReader = new ZXing.BrowserMultiFormatReader();
                }

                // 1. Pancing izin kamera
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                stream.getTracks().forEach(track => track.stop());

                // 2. Dapatkan list perangkat
                const videoDevices = await codeReader.listVideoInputDevices();
                
                // 3. Cari kamera belakang
                let selectedDeviceId = null;
                const backCamera = videoDevices.find(device => 
                    /back|rear|environment|belakang/i.test(device.label)
                );

                // Default ke kamera terakhir jika label tidak ditemukan
                selectedDeviceId = backCamera ? backCamera.deviceId : videoDevices[videoDevices.length - 1].deviceId;

                console.log("Menggunakan Kamera:", selectedDeviceId);

                await codeReader.decodeFromVideoDevice(selectedDeviceId, 'video', (result, err) => {
                    if (result) {
                        const found = products.value.find(p => p.barcode === result.text);
                        if (found) {
                            addToCart(found);
                            navigator.vibrate?.(100);
                            stopScanner();
                        } else {
                            console.log("Barcode tidak terdaftar:", result.text);
                        }
                    }
                });
            } catch (err) {
                console.error("Scanner Error:", err);
                isScanning.value = false;
                alert("Kamera error. Pastikan izin diberikan & gunakan HTTPS.");
            }
        };

        const stopScanner = () => {
            if (codeReader) {
                codeReader.reset();
            }
            isScanning.value = false;
        };

        const printLabel = (product) => {
            const printTitle = document.getElementById('print-title');
            if (printTitle) printTitle.innerText = product.name;
            JsBarcode("#print-barcode", product.barcode);
            window.print();
        };

        const formatDate = (date) => {
            return new Intl.DateTimeFormat('id-ID', { 
                dateStyle: 'medium', 
                timeStyle: 'short' 
            }).format(new Date(date));
        };

        onMounted(loadData);

        return {
            activeTab, dbStatus, products, transactions, cart, cartTotal,
            isScanning, showAddProduct, newProd,
            saveProduct, updateQty, checkout, startScanner, stopScanner, printLabel, formatDate
        };
    }
}).mount('#app');
