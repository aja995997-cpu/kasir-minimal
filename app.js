const { createApp, ref, onMounted, computed, nextTick } = Vue;

const app = createApp({
    setup() {
        // --- DATABASE SETUP ---
        const db = new Dexie("ZafPOS_DB");
        db.version(1).stores({
            products: "++id, name, price, stock, &barcode",
            transactions: "++id, total, date"
        });

        // --- STATE ---
        const activeTab = ref('pos');
        const dbStatus = ref('Offline Mode');
        const products = ref([]);
        const transactions = ref([]);
        const cart = ref([]);
        const isScanning = ref(false);
        const isContinuous = ref(false); // Fitur baru: Toggle Continue
        const showAddProduct = ref(false);
        const newProd = ref({ name: '', price: 0, stock: 0, barcode: '' });

        let codeReader = null;
        let lastScannedCode = null; // Untuk mencegah double scan barang yang sama dalam waktu singkat
        let scanTimeout = null;

        const cartTotal = computed(() => cart.value.reduce((acc, item) => acc + (item.price * item.qty), 0));

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
            } catch (e) { alert("Barcode sudah ada"); }
        };

        const addToCart = (product) => {
            const existing = cart.value.find(i => i.id === product.id);
            if (existing) {
                existing.qty++;
            } else {
                cart.value.push({ ...product, qty: 1 });
            }
            navigator.vibrate?.(100);
        };

        const updateQty = (item, change) => {
            const index = cart.value.findIndex(i => i.id === item.id);
            if (index !== -1) {
                cart.value[index].qty += change;
                if (cart.value[index].qty <= 0) cart.value.splice(index, 1);
            }
        };

        const checkout = async () => {
            if (!cart.value.length) return;
            const trx = { items: JSON.parse(JSON.stringify(cart.value)), total: cartTotal.value, date: new Date() };
            await db.transactions.add(trx);
            for (const item of cart.value) {
                await db.products.where('id').equals(item.id).modify(p => p.stock -= item.qty);
            }
            cart.value = [];
            alert("Berhasil!");
            await loadData();
        };

        // --- SCANNER LOGIC (CONTINUOUS MODE) ---
        const startScanner = async () => {
            isScanning.value = true;
            lastScannedCode = null;
            
            try {
                if (!codeReader) codeReader = new ZXing.BrowserCodeReader();

                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                stream.getTracks().forEach(track => track.stop());

                const videoDevices = await codeReader.listVideoInputDevices();
                let selectedDeviceId = videoDevices.find(d => /back|rear|environment/i.test(d.label))?.deviceId 
                                     || videoDevices[videoDevices.length - 1].deviceId;

                await codeReader.decodeFromVideoDevice(selectedDeviceId, 'video', (result, err) => {
                    if (result) {
                        // Logika Anti-Spam: Jangan scan barcode yang sama dalam 2 detik jika mode berlanjut
                        if (isContinuous.value && result.text === lastScannedCode) return;

                        const found = products.value.find(p => p.barcode === result.text);
                        if (found) {
                            addToCart(found);
                            lastScannedCode = result.text;
                            
                            // Jika mode sekali scan, matikan scanner
                            if (!isContinuous.value) {
                                stopScanner();
                            } else {
                                // Reset memory barcode terakhir setelah 2 detik agar bisa scan barang yang sama lagi
                                clearTimeout(scanTimeout);
                                scanTimeout = setTimeout(() => { lastScannedCode = null; }, 2000);
                            }
                        }
                    }
                });
            } catch (err) {
                console.error(err);
                isScanning.value = false;
            }
        };

        const stopScanner = () => {
            if (codeReader) codeReader.reset();
            isScanning.value = false;
        };

        const printLabel = (p) => {
            document.getElementById('print-title').innerText = p.name;
            JsBarcode("#print-barcode", p.barcode);
            window.print();
        };

        const formatDate = (date) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date));

        onMounted(loadData);

        return {
            activeTab, dbStatus, products, transactions, cart, cartTotal,
            isScanning, isContinuous, showAddProduct, newProd,
            saveProduct, updateQty, checkout, startScanner, stopScanner, printLabel, formatDate
        };
    }
}).mount('#app');
