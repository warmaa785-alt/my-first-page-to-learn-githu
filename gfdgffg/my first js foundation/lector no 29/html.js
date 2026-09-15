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

const whatsappButton = document.querySelector('#whatsapp-button');

whatsappButton?.addEventListener('click', () => {
    const phoneNumber = '917564887471';
    const message = 'Hello, I want to know about your welding services.';
    const whatsappUrl = `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank', 'noopener');

    window.open(whatsappUrl, '_blank', 'noopener');
});

