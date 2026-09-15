// export default function add(a, b) {
//   return a + b;
// }

// export const pi = 3.14;
// Cart variables
let cart = [];
const cartCountEl = document.getElementById('cart-count');
const cartItemsEl = document.getElementById('cart-items');
const cartTotalEl = document.getElementById('cart-total');
const cartSidebarEl = document.getElementById('cart-sidebar');

// Open/Close Cart Sidebar
function toggleCart() {
    cartSidebarEl.classList.toggle('active');
}

// Add Item to Cart Functionality
document.querySelectorAll('.add-to-cart-btn').forEach(button => {
    button.addEventListener('click', (e) => {
        const card = e.target.closest('.service-card');
        const id = card.getAttribute('data-id');
        const name = card.getAttribute('data-name');
        const price = parseInt(card.getAttribute('data-price'));

        // Check if already in cart
        const existingItem = cart.find(item => item.id === id);
        if (existingItem) {
            alert("यह सेवा पहले से ही कार्ट में है!");
            return;
        }

        // Add to array
        cart.push({ id, name, price });
        updateCartUI();
    });
});

// Update Cart View
function updateCartUI() {
    // Total Count
    cartCountEl.innerText = cart.length;

    // Clear items list
    cartItemsEl.innerHTML = '';

    if (cart.length === 0) {
        cartItemsEl.innerHTML = '<p class="empty-msg">आपका कार्ट खाली है।</p>';
        cartTotalEl.innerText = '0';
        return;
    }

    let total = 0;
    cart.forEach((item, index) => {
        total += item.price;
        
        const itemEl = document.createElement('div');
        itemEl.classList.add('cart-item');
        itemEl.innerHTML = `
            <div>
                <h4>${item.name}</h4>
                <small>₹${item.price}</small>
            </div>
            <span class="remove-btn" onclick="removeItem(${index})">&times;</span>
        `;
        cartItemsEl.appendChild(itemEl);
    });

    cartTotalEl.innerText = total;
}

// Remove Item from Cart
function removeItem(index) {
    cart.splice(index, 1);
    updateCartUI();
}

// Send Order to WhatsApp
function sendWhatsAppOrder() {
    if (cart.length === 0) {
        alert("कृपया पहले कोई सेवा कार्ट में जोड़ें!");
        return;
    }

    let message = "नमस्ते WeldPro! मैं आपकी वेबसाइट से ये सेवाएं बुक करना चाहता हूँ:\n\n";
    cart.forEach((item, i) => {
        message += `${i+1}. ${item.name} - ₹${item.price}\n`;
    });
    message += `\n*कुल अनुमानित बजट:* ₹${cartTotalEl.innerText}`;

    function openWhatsApp() {
  window.open(
    "https://wa.me/917564887471?text=Hello%20mujhe%20jankari%20chahiye",
    "_blank"
  );
}
    