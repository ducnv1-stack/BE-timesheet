const confirmedAt = new Date("2026-03-05T00:10:00+07:00");
console.log("Giờ Việt Nam:", confirmedAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
console.log("Giờ UTC gốc:", confirmedAt.toISOString());
const adjustedDate = new Date(confirmedAt.getTime() + 7 * 60 * 60 * 1000).toISOString().split('T')[0];
console.log("Ngày sau khi bù 7 giờ (dùng cho biểu đồ):", adjustedDate);

const expectedDate = "2026-03-05";
if (adjustedDate === expectedDate) {
    console.log("--- KẾT QUẢ: THÀNH CÔNG (Khớp ngày Việt Nam) ---");
} else {
    console.log("--- KẾT QUẢ: THẤT BẠI ---");
}
