import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function syncAddresses() {
    console.log('🚀 Starting Vietnamese address synchronization...');

    try {
        const response = await fetch('https://vietnamlabs.com/api/vietnamprovince');
        if (!response.ok) {
            throw new Error(`Failed to fetch address data: ${response.statusText}`);
        }

        const { data } = await response.json();

        if (!Array.isArray(data)) {
            throw new Error('Invalid API response format: "data" is not an array.');
        }

        console.log(`📦 Found ${data.length} provinces. Processing...`);

        for (const provinceData of data) {
            const { province: provinceName, id: apiId, wards } = provinceData;

            // 1. Upsert Province
            const province = await prisma.province.upsert({
                where: { apiId: apiId.toString() },
                update: { name: provinceName },
                create: {
                    apiId: apiId.toString(),
                    name: provinceName,
                },
            });

            console.log(`📍 Province: ${provinceName} (API ID: ${apiId})`);

            if (Array.isArray(wards)) {
                // 2. Process Wards
                // To handle deletion of wards not in API (optional), but here we just upsert
                for (const wardData of wards) {
                    const { name: wardName } = wardData;

                    // Note: The API doesn't provide unique IDs for Wards across provinces.
                    // We use a combination of provinceId and ward name for uniqueness check or just findFirst.
                    // Here we check if the ward already exists for this province.

                    const existingWard = await prisma.ward.findFirst({
                        where: {
                            provinceId: province.id,
                            name: wardName,
                        },
                    });

                    if (!existingWard) {
                        await prisma.ward.create({
                            data: {
                                provinceId: province.id,
                                name: wardName,
                            },
                        });
                    }
                }
                console.log(`   └─ ✅ Synced ${wards.length} wards.`);
            }
        }

        console.log('✨ Address synchronization completed successfully!');
    } catch (error) {
        console.error('❌ Error during synchronization:', error);
    } finally {
        await prisma.$disconnect();
    }
}

syncAddresses();
