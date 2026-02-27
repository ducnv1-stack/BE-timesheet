async function test() {
    const res = await fetch('http://localhost:3001/dashboard?userId=d1e1882c-4638-40af-a9e3-a1288c1c4b8b'); // Use a known director ID or any ID that hits director
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}
test().catch(console.error);
