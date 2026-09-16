console.log();
// let num = 2;
// num += 5;
// console.log(num);
// num -= 5;
// console.log(num);
// num *= 5;
// console.log(num);
// num /= 5;
// console.log(num);
// num %= 5;
// console.log(num);
// let num = 10;
// console.log(num);
// num += 5;
// console.log(num);
// console.log(8+4);
// console.log("therer is nothing to do");
// console.log("there is somthing to do");
// console.log("therer is one thing to do");
// function addNumbers(a,b){
//     let sum = a+b;
//     return sum;
// }
// let result1 = addNumbers(33,55)
// let result2 = addNumbers(444,555)
// console.log(result1);
// console.log(result2);

// console.log("pahla total = "  + result1);
// console.log("dustra total = " + result2);

// for
// (let i = 1; i <= 100; i++) {
//     console.log("number = " + i);

// }
// for (let i = 1; i <= 100; i++) {
//     console.log("number: " + i);
// }
// let energy = 20;
// while(energy >10) {
//     console.log("Energy level: " + energy);
//     energy--;
// }
// let count = 10 ;
// do{
//     console.log( "count = " + count);
// }
//     while (count <5);
// function rollDice(){
//     let randomNumber = Math.random() * 6;
//     let finalDicevalue = Math.floor(randomNumber) + 1;
//     return finalDicevalue;
// }
// let players =  ["aksahy", "rahul", "dipak", "virat" ];
// console.log("players name")
// for (let aksh = 0; aksh < players.length; aksh++){
//     let result = rollDice();
//     let curentName = players[aksh];
//     console.log(curentName + " ki chal me " + result);
// }
// let a = [1,2]
// let b = [3,4]

// let c = [...a, ...b]
// console.log(...c);
// import add, { pi } from '../mathUtils.js';
// console.log(add(2,3), pi);
// let object1 = {
//     name: "rahul",
//     age : 22, 
//     phone: 7564887471
// }
// let object2 = {
//     address: "bihar",
//     adharCard : 7669496319992,
//     marks: 99,
//     name: "akshay"
// }
// let object3 = {...object1, ...object2}
// console.log(object3);
// const arr = [23, 24,56,37,578,577,]
// arr [4] = 300
// console.log(arr);

const phoneNumber = '917564887471';
const defaultMessage = 'Namaste, main welding services ke baare mein jankari chahata hoon.';

function openWhatsApp(message = defaultMessage) {
  const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
  window.open(whatsappUrl, '_blank', 'noopener');
}

function toggleCart() {
  const cartSidebar = document.getElementById('cart-sidebar');
  if (!cartSidebar) return;
  cartSidebar.classList.toggle('active');
}

window.toggleCart = toggleCart;

let cart = [];

function updateCartUI() {
  const cartCountEl = document.getElementById('cart-count');
  const cartItemsEl = document.getElementById('cart-items');
  const cartTotalEl = document.getElementById('cart-total');

  if (!cartCountEl || !cartItemsEl || !cartTotalEl) return;

  cartCountEl.innerText = cart.length;
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
      <span class="remove-btn" data-index="${index}" style="cursor:pointer; color:red; font-weight:bold;">&times;</span>
    `;

    const removeBtn = itemEl.querySelector('.remove-btn');
    removeBtn.addEventListener('click', () => removeItem(Number(removeBtn.dataset.index)));
    cartItemsEl.appendChild(itemEl);
  });

  cartTotalEl.innerText = total;
}

function removeItem(index) {
  cart.splice(index, 1);
  updateCartUI();
}

function sendWhatsAppOrder() {
  if (cart.length === 0) {
    alert('कृपया पहले कोई सेवा कार्ट में जोड़ें!');
    return;
  }

  const cartTotalEl = document.getElementById('cart-total');
  let message = 'नमस्ते WeldPro! मैं आपकी वेबसाइट से ये सेवाएं बुक करना चाहता हूँ:\n\n';

  cart.forEach((item, i) => {
    message += `${i + 1}. ${item.name} - ₹${item.price}\n`;
  });

  message += `\n*कुल अनुमानित बजट:* ₹${cartTotalEl ? cartTotalEl.innerText : '0'}`;
  openWhatsApp(message);
}

window.sendWhatsAppOrder = sendWhatsAppOrder;

const whatsappButton = document.querySelector('#whatsapp-button');

whatsappButton?.addEventListener('click', () => {
  openWhatsApp();
});

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.add-to-cart-btn').forEach(button => {
    button.addEventListener('click', (event) => {
      const card = event.currentTarget.closest('.service-card');
      if (!card) return;

      const id = card.getAttribute('data-id');
      const name = card.getAttribute('data-name');
      const price = Number(card.getAttribute('data-price'));

      const existingItem = cart.find(item => item.id === id);
      if (existingItem) {
        alert('यह सेवा पहले से ही कार्ट में है!');
        return;
      }

      cart.push({ id, name, price });
      updateCartUI();
      toggleCart();
    });
  });

  const cartIcon = document.querySelector('.cart-icon');
  cartIcon?.addEventListener('click', () => toggleCart());
  updateCartUI();

  const chatButton = document.createElement('button');
  chatButton.textContent = '💬';
  chatButton.setAttribute('aria-label', 'Chat with us');
  Object.assign(chatButton.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    width: '62px',
    height: '62px',
    border: 'none',
    borderRadius: '50%',
    background: '#25D366',
    color: '#fff',
    fontSize: '28px',
    cursor: 'pointer',
    boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
    zIndex: '9999'
  });

  const chatBox = document.createElement('div');
  chatBox.style.position = 'fixed';
  chatBox.style.right = '20px';
  chatBox.style.bottom = '95px';
  chatBox.style.width = '320px';
  chatBox.style.maxWidth = 'calc(100vw - 20px)';
  chatBox.style.background = '#ffffff';
  chatBox.style.color = '#111';
  chatBox.style.borderRadius = '16px';
  chatBox.style.boxShadow = '0 15px 35px rgba(0,0,0,0.2)';
  chatBox.style.overflow = 'hidden';
  chatBox.style.display = 'none';
  chatBox.style.zIndex = '9998';
  chatBox.style.fontFamily = 'Segoe UI, sans-serif';

  const chatHeader = document.createElement('div');
  chatHeader.textContent = 'Welding Shop Assistant';
  Object.assign(chatHeader.style, {
    background: '#062634',
    color: '#fff',
    padding: '12px 16px',
    fontWeight: '700',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  });

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  Object.assign(closeBtn.style, {
    background: 'transparent',
    border: 'none',
    color: '#fff',
    fontSize: '18px',
    cursor: 'pointer'
  });

  const chatMessages = document.createElement('div');
  Object.assign(chatMessages.style, {
    padding: '14px',
    height: '260px',
    overflowY: 'auto',
    background: '#f5f5f5'
  });

  function addMessage(sender, text) {
    const message = document.createElement('div');
    const bubble = document.createElement('div');
    bubble.textContent = text;

    if (sender === 'user') {
      message.style.textAlign = 'right';
      bubble.style.background = '#25D366';
      bubble.style.color = '#fff';
      bubble.style.marginLeft = 'auto';
    } else {
      message.style.textAlign = 'left';
      bubble.style.background = '#e9ecef';
      bubble.style.color = '#111';
      bubble.style.marginRight = 'auto';
    }

    bubble.style.maxWidth = '80%';
    bubble.style.display = 'inline-block';
    bubble.style.padding = '10px 12px';
    bubble.style.borderRadius = '12px';
    bubble.style.marginBottom = '10px';
    bubble.style.lineHeight = '1.4';
    message.appendChild(bubble);
    chatMessages.appendChild(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  const chatForm = document.createElement('form');
  Object.assign(chatForm.style, {
    display: 'flex',
    borderTop: '1px solid #ddd',
    background: '#fff',
    padding: '10px'
  });

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type your message...';
  Object.assign(input.style, {
    flex: '1',
    border: '1px solid #ddd',
    borderRadius: '10px',
    padding: '10px 12px',
    marginRight: '8px',
    outline: 'none'
  });

  const sendBtn = document.createElement('button');
  sendBtn.type = 'submit';
  sendBtn.textContent = 'Send';
  Object.assign(sendBtn.style, {
    background: '#ffcc00',
    border: 'none',
    borderRadius: '10px',
    padding: '10px 14px',
    fontWeight: '700',
    cursor: 'pointer'
  });

  function getReply(userText) {
    const text = userText.toLowerCase();

    if (text.includes('hi') || text.includes('hello') || text.includes('namaste')) {
      return 'Namaste! Hum welding shop se connected hain. Aap gate, railing, or custom fabrication ke baare mein janna chahte hain?';
    }

    if (text.includes('price') || text.includes('rate') || text.includes('kitna') || text.includes('cost')) {
      return 'Hum different work ke hisaab se pricing dete hain. Gate aur grille ₹15,000 se, steel railing ₹12,000 se, aur custom work ke liye personalized quote diya jata hai.';
    }

    if (text.includes('service') || text.includes('kaam') || text.includes('work')) {
      return 'Hum iron gate, steel railing, shatter, channel gate, custom fabrication, aur industrial welding services provide karte hain.';
    }

    if (text.includes('gate') || text.includes('grill')) {
      return 'Iron gate aur grill ke liye aap humse direct contact kar sakte hain. Hum stylish aur durable design banate hain.';
    }

    if (text.includes('railing') || text.includes('stair') || text.includes('balcony')) {
      return 'Steel railing aur balcony railings ke liye hum modern aur strong solutions banate hain.';
    }

    if (text.includes('contact') || text.includes('call') || text.includes('phone') || text.includes('number')) {
      return 'Aap humse WhatsApp par contact kar sakte hain: +91 7564887471';
    }

    if (text.includes('location') || text.includes('address') || text.includes('kahan')) {
      return 'Aap humse direct WhatsApp par location aur appointment ke liye contact kar sakte hain.';
    }

    if (text.includes('working') || text.includes('time') || text.includes('timing') || text.includes('hours')) {
      return 'Hum weekdays mein available hote hain. Aap WhatsApp par appointment book kar sakte hain.';
    }

    return 'Aapke sawal ke liye hum help kar sakte hain. Aap gate, railing, shatter, pricing, ya contact details ke baare mein pooch sakte hain. Aap humse WhatsApp par bhi direct discuss kar sakte hain.';
  }

  chatHeader.appendChild(closeBtn);
  chatBox.appendChild(chatHeader);
  chatBox.appendChild(chatMessages);
  chatForm.appendChild(input);
  chatForm.appendChild(sendBtn);
  chatBox.appendChild(chatForm);
  document.body.appendChild(chatButton);
  document.body.appendChild(chatBox);

  addMessage('bot', 'Namaste! Main welding shop assistant hoon. Aap gate, railing, pricing, ya contact ke baare mein pooch sakte hain.');

  closeBtn.addEventListener('click', () => {
    chatBox.style.display = 'none';
    chatButton.style.display = 'block';
  });

  chatButton.addEventListener('click', () => {
    chatBox.style.display = 'block';
    chatButton.style.display = 'none';
    input.focus();
  });

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const userInput = input.value.trim();
    if (!userInput) return;

    addMessage('user', userInput);
    input.value = '';

    const reply = getReply(userInput);
    setTimeout(() => {
      addMessage('bot', reply);
    }, 400);
  });
});