const { createApp, ref, onMounted, computed, watch, nextTick } = Vue;

const app = createApp({
    setup() {
        // --- DATA & DB SETUP ---
        const db = new Dexie("ZafPOS_DB");
        db.version(1).stores({
            products: "++id, name, price, stock, &barcode",
            transactions: "++id, total, date"
        });

        const activeTab = ref('pos');
        const dbStatus = ref('Offline Mode');
        const products = ref([]);
        const transactions = ref([]);
        const cart = ref([]);
        const isScanning = ref(false);
        const showAddProduct = ref(false);

        const newProd = ref({ name: '', price: 0, stock: 0, barcode: '' });

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
                    JsBarcode(`#bc-${p.barcode}`, p.barcode, { height: 30, fontSize: 10 });
                });
            });
        };

        const saveProduct = async () => {
            if (!newProd.value.barcode) newProd.value.barcode = Date.now().toString();
            await db.products.add({ ...newProd.value });
            newProd.value = { name: '', price: 0, stock: 0, barcode: '' };
            showAddProduct.value = false;
            await loadData();
        };

        const updateQty = (item, change) => {
            const index = cart.value.findIndex(i => i.id === item.id);
            cart.value[index].qty += change;
            if (cart.value[index].qty <= 0) cart.value.splice(index, 1);
        };

        const checkout = async () => {
            if (cart.value.length === 0) return;
            const trx = {
                items: JSON.parse(JSON.stringify(cart.value)),
                total: cartTotal.value,
                date: new Date()
            };
            await db.transactions.add(trx);
            // Kurangi stok riil
            for (const item of cart.value) {
                await db.products.where('id').equals(item.id).modify(p => p.stock -= item.qty);
            }
            cart.value = [];
            alert("Transaksi Berhasil!");
            loadData();
        };

        // --- SCANNER LOGIC ---
        let codeReader = null;
        const startScanner = async () => {
            isScanning.value = true;
            codeReader = new ZXing.BrowserMultiFormatReader();
            const videoInputDevices = await codeReader.listVideoInputDevices();
            const selectedDeviceId = videoInputDevices[0].deviceId;

            codeReader.decodeFromVideoDevice(selectedDeviceId, 'video', (result, err) => {
                if (result) {
                    const found = products.value.find(p => p.barcode === result.text);
                    if (found) {
                        addToCart(found);
                        stopScanner();
                    }
                }
            });
        };

        const addToCart = (product) => {
            const existing = cart.value.find(i => i.id === product.id);
            if (existing) existing.qty++;
            else cart.value.push({ ...product, qty: 1 });
        };

        const stopScanner = () => {
            if (codeReader) codeReader.reset();
            isScanning.value = false;
        };

        const printLabel = (product) => {
            document.getElementById('print-title').innerText = product.name;
            JsBarcode("#print-barcode", product.barcode);
            window.print();
        };

        const formatDate = (date) => new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(date);

        onMounted(loadData);

        return {
            activeTab, dbStatus, products, transactions, cart, cartTotal,
            isScanning, showAddProduct, newProd,
            saveProduct, updateQty, checkout, startScanner, stopScanner, printLabel, formatDate
        };
    }
}).mount('#app');