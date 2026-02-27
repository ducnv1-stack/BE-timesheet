import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function parseDate(dateStr: string | null | undefined): Promise<Date | null> {
    if (!dateStr || dateStr.trim() === '' || dateStr === 'Không xác định') return null;
    const parts = dateStr.split('/');
    if (parts.length === 3) {
        // DD/MM/YYYY
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }
    if (parts.length === 2) {
        // DD/MM (assume current year if needed, but better null if incomplete)
        return null;
    }
    return null;
}

async function main() {
    const branches = [
        { code: 'CONGTY', name: 'Công ty' },
        { code: '131HD', name: '131 HD' },
        { code: '258HD', name: '258 HD' },
        { code: '1012LANG', name: '1012 Láng' },
        { code: '639QT', name: '639 QT - HĐ' },
        { code: 'HAIPHONG', name: 'Hải Phòng' },
        { code: 'THANHHOA', name: 'Thanh Hóa' },
        { code: 'DANANG', name: 'Đà Nẵng' },
        { code: 'TOTAL', name: 'Hải Phòng' }, // Duplicate name in data, mapped to existing
    ];

    console.log('Upserting branches...');
    for (const b of branches) {
        await prisma.branch.upsert({
            where: { code: b.code },
            update: { name: b.name },
            create: { code: b.code, name: b.name },
        });
    }

    const roles = [
        { code: 'ADMIN', name: 'Quản trị viên' },
        { code: 'DIRECTOR', name: 'Giám đốc' },
        { code: 'MANAGER', name: 'Quản lý' },
        { code: 'CHIEF_ACCOUNTANT', name: 'Kế toán trưởng' },
        { code: 'ACCOUNTANT', name: 'Kế toán chi nhánh' },
        { code: 'SALE', name: 'Nhân viên bán hàng' },
        { code: 'DRIVER', name: 'Lái xe' },
    ];

    console.log('Upserting roles...');
    for (const r of roles) {
        await prisma.role.upsert({
            where: { code: r.code },
            update: { name: r.name },
            create: { code: r.code, name: r.name },
        });
    }

    const branchMap: Record<string, string> = {};
    const allBranches = await prisma.branch.findMany();
    allBranches.forEach((b) => {
        branchMap[b.name.trim()] = b.id;
    });

    const rawData = [
        { fullName: 'Nguyễn Huy Hoàng', position: 'GĐ', department: 'BGĐ', branch: 'Công ty', birthday: '', birthMonth: '', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Không xác định TG', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Võ Văn Tài', position: 'GĐ', department: 'BGĐ', branch: 'Công ty', birthday: '', birthMonth: '', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Không xác định TG', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Sái Trường Giang', position: 'GĐKD', department: 'BGĐ', branch: 'Công ty', birthday: '', birthMonth: '', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Không xác định TG', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Trần Thị Hà', position: 'Trợ lý GĐ', department: 'BGĐ', branch: 'Công ty', birthday: '13/06/1994', birthMonth: '6', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Không xác định TG', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Nguyễn Tuấn Huy', position: 'Quản Lý', department: 'BGĐ', branch: '131 HD', birthday: '12/12/1985', birthMonth: '12', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Không xác định TG', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Phạm Quốc Thái', position: 'ADS', department: 'MKT', branch: 'Công ty', birthday: '19/09/1996', birthMonth: '9', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '038096034385', address: 'Thôn 2 Nga Tân - Nga Sơn - Thanh Hóa', phone: '0369900988', email: 'hagridpham@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Văn Nhất', position: 'Media', department: 'MKT', branch: 'Công ty', birthday: '10/09/2001', birthMonth: '9', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '038201007173', address: 'Phúc Thôn - Định Long - Yên Định - Thanh Hóa', phone: '0367893279', email: 'nguyenngocnhat899@gmail.com', bhxh: '' },
        { fullName: 'Phạm Quỳnh Anh', position: 'HCNS', department: 'HCKT', branch: 'Công ty', birthday: '06/11/2002', birthMonth: '11', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '07/11/2025', idCardNumber: '001302018520', address: '17 ngõ 371 Kim Mã - Giảrg Võ - Hà Nội', phone: '0983903611', email: 'quynhanhph061102@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Bùi Minh Ánh', position: 'Kế toán', department: 'HCKT', branch: 'Công ty', birthday: '15/08/2000', birthMonth: '8', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '066300016480', address: '', phone: '0918638504', email: 'minhanhnhatha@gmail.com', bhxh: '' },
        { fullName: 'Đào Thị Ly', position: 'Kế toán', department: 'HCKT', branch: 'Công ty', birthday: '14/09/1987', birthMonth: '9', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Đặng Thị Đào', position: 'HCNS', department: 'HCKT', branch: '131 HD', birthday: '', birthMonth: '12', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Nguyễn Ngọc Vinh', position: 'NVKT', department: 'Kỹ Thuật', branch: 'Công ty', birthday: '24/12/1994', birthMonth: '12', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Trần Mạnh Khởi', position: 'NVKT', department: 'Kỹ Thuật', branch: 'Công ty', birthday: '06/09/1987', birthMonth: '9', gender: 'Nam', status: 'Đang làm việc', workingType: 'Hành Chính', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '', address: '', phone: '', email: '', bhxh: '' },
        { fullName: 'Nghiêm Trọng Kiên', position: 'Nhân viên', department: 'Kho', branch: 'Công ty', birthday: '12/06/1991', birthMonth: '6', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '08/01/2026', idCardNumber: '030091003372', address: '6/25 An Thái - Bình Hàn - TP Hải Dương', phone: '', email: '', bhxh: '' },
        { fullName: 'Nghiêm Xuân Tùng', position: 'Nhân viên', department: 'Kho', branch: 'Công ty', birthday: '10/12/1992', birthMonth: '12', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '08/01/2026', idCardNumber: '030092002989', address: '77 An Thái - Bình Hàn - TP Hải Dương', phone: '', email: '', bhxh: '' },
        { fullName: 'Nguyễn Mạnh Tùng', position: 'Nhân viên', department: 'Lái xe', branch: 'Hải Phòng', birthday: '26/2/1989', birthMonth: '2', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '03/10/2025', idCardNumber: '031089002539', address: '216 An Lạn 1 - Sở Dầu - Hồng Bàng - Hải Phòng', phone: '', email: '', bhxh: '' },
        { fullName: 'Tràng Văn Tuyển', position: 'Nhân viên', department: 'Lái xe', branch: '1012 Láng', birthday: '9/10/1979', birthMonth: '10', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '21/01/2026', idCardNumber: '033079005394', address: 'Thôn Xuân Tràng - Đồng Than - Yên Mỹ - Hưng Yên', phone: '', email: '', bhxh: '' },
        { fullName: 'Đào Văn Ngọc', position: 'Nhân viên', department: 'Lái xe', branch: 'Công ty', birthday: '25/11/1971', birthMonth: '11', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '08/01/2026', idCardNumber: '030071005717', address: 'Khu 3 Nhị Châu - Thành phố Hải Dương', phone: '', email: '', bhxh: '' },
        { fullName: 'Trần Tư Duy', position: 'Quản Lý', department: 'Phòng KD', branch: '1012 Láng', birthday: '26/08/1993', birthMonth: '8', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '001099033801', address: 'Cẩm Cơ - Hồng Vân - Thường Tín - Hà Nội', phone: '0965636460', email: 'tranduyohari@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Thanh Tùng', position: 'Quản Lý', department: 'Phòng KD', branch: '639 QT - HĐ', birthday: '03/01/2000', birthMonth: '1', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '15/09/2025', idCardNumber: '031200004718', address: 'Thôn Bình Huệ - Quang Phục - Tiên Lãng - Hải Phòng', phone: '0965645045', email: 'huyenanhohari@gmail.com', bhxh: '' },
        { fullName: 'Lê Thị Luận', position: 'Quản Lý', department: 'Phòng KD', branch: 'Thanh Hóa', birthday: '14/06/1998', birthMonth: '6', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '038196025565', address: 'Châu Thôn 1 - Yên Lạc - Yên Định - Thanh Hóa', phone: '0978083773', email: 'leluanoharith@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Văn Quang', position: 'Quản Lý', department: 'Phòng KD', branch: 'Hải Phòng', birthday: '09/02/1997', birthMonth: '2', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '031200009705', address: 'Nhân Mục - Nhân Hòa - Vĩnh Bảo - Hải Phòng', phone: '0928410888', email: 'nguyentungquangak47@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Thị Lan', position: 'Quản Lý', department: 'Phòng KD', branch: '131 HD', birthday: '27/12/1996', birthMonth: '12', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '024195013893', address: 'Khu dân cư Phú Thọ - Thạch Khôi - TP Hải Phòng', phone: '0989478704', email: 'minhkimlan01.ohari@gmail.com', bhxh: '' },
        { fullName: 'Vũ Văn Chiến', position: 'Quản Lý', department: 'Phòng KD', branch: '258 HD', birthday: '10/10/1989', birthMonth: '10', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '030089007672', address: 'Mỹ Động - Hiến Thành - TX Kinh Môn - Hải Dương', phone: '0975176485', email: 'minhchienohari89@gmail.com', bhxh: '' },
        { fullName: 'Trần Quang Phúc', position: 'Quản Lý', department: 'Phòng KD', branch: 'Đà Nẵng', birthday: '08/01/1991', birthMonth: '1', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '052091023565', address: '14 Nguyễn Thị Minh Khai - TP Quy Nhơn - Bình Định', phone: '0908606879', email: 'Phuctran.kakaku@gmail.com', bhxh: '' },
        { fullName: 'Trần Tài Thọ', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '16/10/1998', birthMonth: '10', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '15/09/2025', idCardNumber: '031098001066', address: 'Hoàng Đông - Quang Phục - Tiên Lãng - Hải Phòng', phone: '0941689607', email: 'trantho16101998@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Quyết Thắng', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '27/02/2003', birthMonth: '2', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '15/09/2025', idCardNumber: '001203003174', address: '405 Tổ 17 Láng Thượng - Đống Đa - Hà Nội', phone: '0965615670', email: 'nguyenthang27203@gmail.com', bhxh: '' },
        { fullName: 'Phạm Đức Thành', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '31/05/2000', birthMonth: '5', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '15/09/2025', idCardNumber: '031200006995', address: 'Hoàng Đông - Quang Phục - Tiên Lãng - Hải Phòng', phone: '0974718720', email: 'thanhphamohari@gmail.com', bhxh: '' },
        { fullName: 'Đặng Viết Hoàng', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '17/01/2000', birthMonth: '1', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '', address: '', phone: '0982474114', email: 'hoangquanohari1799@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Hoàng Linh', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '11/08/1997', birthMonth: '8', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '15/09/2025', idCardNumber: '001097021030', address: 'Tổ 19 Tương Mai - Hoàng Mai - Hà Nội', phone: '0965614961', email: 'hoanglinhohari.com.vn', bhxh: '' },
        { fullName: 'Nguyễn Đức Mạnh', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '12/09/2002', birthMonth: '9', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '15/09/2025', idCardNumber: '033202004482', address: 'Tứ Dân - Khoái Châu - Hưng Yên', phone: '0969569846', email: 'thinhohari@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Thành Long', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '16/07/2003', birthMonth: '7', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '19/11/2025', idCardNumber: '001203024310', address: 'Cẩm Cơ - Hồng Vân - Thường Tín - Hà Nội', phone: '0965604114', email: 'nguyenbaphu316@gmail.com', bhxh: '' },
        { fullName: 'Mai Văn Tuấn', position: 'NVBH', department: 'Phòng KD', branch: '1012 Láng', birthday: '11/05/2003', birthMonth: '5', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Đang thử việc', contractSigningDate: '', idCardNumber: '001203043070', address: 'Thôn La Thượng - Hồng Vân - Thường Tín - Hà Nộ', phone: '0961556700', email: 'tuanbanh335@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Văn Hào', position: 'NVBH', department: 'Phòng KD', branch: '639 QT - HĐ', birthday: '16/09/2002', birthMonth: '9', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '19/11/2025', idCardNumber: '037202005367', address: 'Hàn Dưới - Yên Đồng - Yên Mô - Ninh Bình', phone: '0966080220', email: 'Haohanba03@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Hồng Phi', position: 'NVBH', department: 'Phòng KD', branch: '639 QT - HĐ', birthday: '24/09/1994', birthMonth: '9', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '22/12/2025', idCardNumber: '034094018101', address: 'Thôn Cổ Am - Vũ Ninh - Kiến Xương - Thái Bình', phone: '0963639934', email: 'hongphi240994@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Thị Hạnh', position: 'NVBH', department: 'Phòng KD', branch: '639 QT - HĐ', birthday: '05/02/2001', birthMonth: '2', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '22/12/2025', idCardNumber: '034201007821', address: 'Mỹ Khê Tây - Đồng Hòa - Kiến An - Hải Phòng', phone: '0963657661', email: 'hanhohari@gmail.com', bhxh: '' },
        { fullName: 'Ngô Thị Lan', position: 'NVBH', department: 'Phòng KD', branch: 'Thanh Hóa', birthday: '02/04/1994', birthMonth: '4', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '038194013133', address: 'KP Ninh Thành - Quảng Tiến - Sầm Sơn - Thanh Hóa', phone: '0966370440', email: 'ngolanohari@gmail.com', bhxh: '' },
        { fullName: 'Thiều Thùy Linh', position: 'NVBH', department: 'Phòng KD', branch: 'Thanh Hóa', birthday: '23/01/1992', birthMonth: '1', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '038192050704', address: 'Thôn Triệu Tiền - Đông Tiến - Đông Sơn - Thanh Hóa', phone: '0965606210', email: 'thieuthuylinh0@gmail.com', bhxh: '' },
        { fullName: 'Lâm Văn Tân', position: 'NVBH', department: 'Phòng KD', branch: 'Thanh Hóa', birthday: '29/10/1991', birthMonth: '10', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '038091016947', address: '348 Lý Nhân Tông - Đông Thọ - TP Thanh Hóa', phone: '0983648381', email: 'lamvantan291091@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Xuân Bắc', position: 'NVBH', department: 'Phòng KD', branch: 'Hải Phòng', birthday: '12/10/2004', birthMonth: '10', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '031204008101', address: '69 Đ5 Đổng Quốc Bình - Ngô Quyền - Hải Phòng', phone: '0977160813', email: 'bacn12102004@gmail.com', bhxh: '' },
        { fullName: 'Bùi Đức Dũng', position: 'NVBH', department: 'Phòng KD', branch: 'Hải Phòng', birthday: '06/10/1998', birthMonth: '10', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '12/09/2025', idCardNumber: '031098009634', address: 'Đông Khê 2 - Đồng Hòa - Kiến An - Hải Phòng', phone: '0982841221', email: '0982841221oharihp.com@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Mạnh Hiếu', position: 'NVBH', department: 'Phòng KD', branch: 'Hải Phòng', birthday: '29/11/2003', birthMonth: '11', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '19/11/2025', idCardNumber: '031203013089', address: 'Phú Lương - Cấp Tiến - Tiên Lãng - Hải Phòng', phone: '0975782740', email: 'nguyenmanhieuoharihp@gmail.com', bhxh: '' },
        { fullName: 'Trần Phi Long', position: 'NVBH', department: 'Phòng KD', branch: 'Hải Phòng', birthday: '07/09/2003', birthMonth: '9', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '19/11/2025', idCardNumber: '031203000630', address: '4/61/476 Chợ Hàng - Dư Hàng Kênh - Lê Chân - Hải Phòng', phone: '0982018965', email: 'longphi7999@gmail.com', bhxh: '' },
        { fullName: 'Trần Hồng Nhung', position: 'NVBH', department: 'Phòng KD', branch: 'Hải Phòng', birthday: '31/05/2001', birthMonth: '5', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '11/12/2025', idCardNumber: '001301021726', address: 'Kim Long - Thượng Hoàng Long - Phú Xuyên - Hà Nội', phone: '0965634303', email: 'hongnhungoharihp@gmail.com', bhxh: '' },
        { fullName: 'Đinh Thị Kim Ngân', position: 'NVBH', department: 'Phòng KD', branch: '131 HD', birthday: '10/03/2004', birthMonth: '3', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '05/01/2026', idCardNumber: '030304012933', address: 'Khuê Liễu - Tân Hưng - TP Hải Dương', phone: '0979140264', email: 'minhkimlanohari.02@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Hoài Bắc', position: 'NVBH', department: 'Phòng KD', branch: '131 HD', birthday: '02/05/1990', birthMonth: '5', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '031090024348', address: 'An Sơn - Thủy Nguyên - Hải Phòng', phone: '0971349241', email: 'bacn12102004@gmail.com', bhxh: '' },
        { fullName: 'Vũ Thị Khuyên', position: 'NVBH', department: 'Phòng KD', branch: '131 HD', birthday: '02/05/1993', birthMonth: '5', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '', idCardNumber: '033193004267', address: 'Tự Cường - Tiên Lãng - Hải Phòng', phone: '0974843647', email: 'thaoghemassagenhat@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Văn Mạnh', position: 'NVBH', department: 'Phòng KD', branch: '131 HD', birthday: '21/07/1995', birthMonth: '7', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Đang thử việc', contractSigningDate: '', idCardNumber: '030095013052', address: 'Thôn Chu Đậu - Thái Tân - Nam Sách - Hải Dương', phone: '0978391551', email: 'manhohari01@gmail.com', bhxh: '' },
        { fullName: 'Phạm Văn Khởi', position: 'NVBH', department: 'Phòng KD', branch: '258 HD', birthday: '12/04/1995', birthMonth: '4', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '03/10/2025', idCardNumber: '30095013089', address: 'Thôn Thuần Mỹ - Vĩnh Lập - Thanh Hà - Hải Dương', phone: '0976713013', email: 'khoioharihaiduong@gmail.com', bhxh: '' },
        { fullName: 'Phan Nhật Hiệp', position: 'NVBH', department: 'Phòng KD', branch: '258 HD', birthday: '22/05/1995', birthMonth: '5', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Hợp đồng 1 năm', contractSigningDate: '08/01/2026', idCardNumber: '030095012624', address: 'Thôn Lang Can 2 - Thanh Lang - Thanh Hà - Hải Dương', phone: '0969196446', email: 'vanhiepohari@gmail.com', bhxh: '' },
        { fullName: 'Lê Thị Phương Thảo', position: 'NVBH', department: 'Phòng KD', branch: '258 HD', birthday: '19/12/2002', birthMonth: '12', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Đang thử việc', contractSigningDate: '', idCardNumber: '030302001213', address: 'Thôn Hoàng Xá - Hồng Hưng - Gia Lộc - Hải Dương', phone: '0982418738', email: 'phuongthao258ohari@gmail.com', bhxh: '' },
        { fullName: 'Nguyễn Thị Khánh Linh', position: 'NVBH', department: 'Phòng KD', branch: '258 HD', birthday: '30/04/2005', birthMonth: '4', gender: 'Nữ', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Đang thử việc', contractSigningDate: '', idCardNumber: '030305004445', address: 'Thôn Tràng Kỹ - Tân Trường - Cẩm Giàng - Hải Dương', phone: '0989569964', email: 'linhohari39@gmail.com', bhxh: '' },
        { fullName: 'Đàm Duy Minh', position: 'NVBH', department: 'Phòng KD', branch: 'Đà Nẵng', birthday: '24/08/2005', birthMonth: '8', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Đang thử việc', contractSigningDate: '', idCardNumber: '038205018502', address: 'Bái Ân 2 - Định Thành - Yên Định - Thanh Hóa', phone: '0969636913', email: 'ddminh124@gmail.com', bhxh: '' },
        { fullName: 'Hồ Vĩnh Đại', position: 'NVBH', department: 'Phòng KD', branch: 'Đà Nẵng', birthday: '22/07/1999', birthMonth: '7', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Đang thử việc', contractSigningDate: '', idCardNumber: '052099000476', address: 'Thượng Sơn - Tây Thuận - Tây Sơn - Bình Định', phone: '0969656823', email: 'vinhdaiohari@gmail.com', bhxh: '' },
        { fullName: 'Huỳnh Công Quốc Đạt', position: 'NVBH', department: 'Phòng KD', branch: 'Đà Nẵng', birthday: '24/06/2003', birthMonth: '6', gender: 'Nam', status: 'Đang làm việc', workingType: 'Full time 8 tiếng', joinDate: '', contractType: 'Đang thử việc', contractSigningDate: '', idCardNumber: '049203011248', address: 'Khối Phố Mỹ Hòa - TT Nam Phước - Duy Xuyên - Quảng Nam', phone: '0969672033', email: 'quocdat5567@gmail.com', bhxh: '' },
    ];

    console.log('Upserting employees...');
    for (const emp of rawData) {
        const branchId = branchMap[emp.branch.trim()];
        if (!branchId) {
            console.warn(`Branch not found: ${emp.branch} for ${emp.fullName}`);
            continue;
        }

        const birthday = await parseDate(emp.birthday);
        const contractSigningDate = await parseDate(emp.contractSigningDate);
        const joinDate = await parseDate(emp.joinDate);
        const birthMonth = emp.birthMonth ? parseInt(emp.birthMonth) : null;

        // Use a unique combination for find or create if idCardNumber is missing
        // Since idCardNumber is @unique, we handle cases where it's provided.
        // If not provided, we might need another way to identify the employee (like fullName + phone).
        // For this seed, let's assume if idCardNumber is missing, we try to match by fullName + branchId.

        let existingEmployee = null;
        if (emp.idCardNumber) {
            existingEmployee = await prisma.employee.findUnique({ where: { idCardNumber: emp.idCardNumber } });
        }

        if (!existingEmployee) {
            existingEmployee = await prisma.employee.findFirst({
                where: {
                    fullName: emp.fullName,
                    branchId: branchId
                }
            });
        }

        if (existingEmployee) {
            await prisma.employee.update({
                where: { id: existingEmployee.id },
                data: {
                    fullName: emp.fullName,
                    position: emp.position,
                    department: emp.department,
                    branchId: branchId,
                    birthday: birthday,
                    birthMonth: birthMonth,
                    gender: emp.gender,
                    status: emp.status,
                    workingType: emp.workingType,
                    joinDate: joinDate,
                    contractType: emp.contractType,
                    contractSigningDate: contractSigningDate,
                    permanentAddress: emp.address,
                    phone: emp.phone,
                    email: emp.email,
                    socialInsuranceNumber: emp.bhxh,
                }
            });
        } else {
            await prisma.employee.create({
                data: {
                    fullName: emp.fullName,
                    position: emp.position,
                    department: emp.department,
                    branchId: branchId,
                    birthday: birthday,
                    birthMonth: birthMonth,
                    gender: emp.gender,
                    status: emp.status,
                    workingType: emp.workingType,
                    joinDate: joinDate,
                    contractType: emp.contractType,
                    contractSigningDate: contractSigningDate,
                    idCardNumber: emp.idCardNumber || null,
                    permanentAddress: emp.address,
                    phone: emp.phone,
                    email: emp.email,
                    socialInsuranceNumber: emp.bhxh,
                }
            });
        }
    }

    console.log('Seeding finished.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
