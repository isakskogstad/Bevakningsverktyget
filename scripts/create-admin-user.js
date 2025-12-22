/**
 * Skapa admin-användare i Supabase
 *
 * Kör med: node scripts/create-admin-user.js
 *
 * Kräver SUPABASE_URL och SUPABASE_SERVICE_KEY som miljövariabler
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wzkohritxdrstsmwopco.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_KEY saknas!');
    console.log('\nSätt miljövariabel och kör igen:');
    console.log('SUPABASE_SERVICE_KEY="din-service-role-key" node scripts/create-admin-user.js');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function createAdminUser() {
    // Läs från miljövariabler eller kommandoradsargument
    const email = process.env.ADMIN_EMAIL || process.argv[2];
    const password = process.env.ADMIN_PASSWORD || process.argv[3];

    if (!email || !password) {
        console.error('❌ E-post och lösenord krävs!');
        console.log('\nAnvänd på något av följande sätt:');
        console.log('1. Med miljövariabler:');
        console.log('   ADMIN_EMAIL="din@epost.se" ADMIN_PASSWORD="ditt-lösenord" node scripts/create-admin-user.js');
        console.log('\n2. Med kommandoradsargument:');
        console.log('   node scripts/create-admin-user.js din@epost.se ditt-lösenord');
        process.exit(1);
    }

    console.log('🔧 Skapar admin-användare...\n');

    try {
        // Skapa användare via Admin API
        const { data: user, error: createError } = await supabase.auth.admin.createUser({
            email: email,
            password: password,
            email_confirm: true // Bekräfta e-post direkt
        });

        if (createError) {
            if (createError.message.includes('already been registered')) {
                console.log('ℹ️  Användaren finns redan, uppdaterar...');

                // Hämta befintlig användare
                const { data: users } = await supabase.auth.admin.listUsers();
                const existingUser = users.users.find(u => u.email === email);

                if (existingUser) {
                    // Uppdatera till admin-roll
                    await supabase
                        .from('user_profiles')
                        .upsert({
                            id: existingUser.id,
                            email: email,
                            role: 'admin'
                        });

                    console.log('✅ Användaren uppdaterad till admin!');
                    return;
                }
            }
            throw createError;
        }

        // Sätt admin-roll i user_profiles
        const { error: profileError } = await supabase
            .from('user_profiles')
            .upsert({
                id: user.user.id,
                email: email,
                role: 'admin'
            });

        if (profileError) {
            console.error('⚠️  Kunde inte sätta admin-roll:', profileError.message);
        }

        console.log('✅ Admin-användare skapad!');
        console.log('\n📧 E-post:', email);
        console.log('🔑 Lösenord:', password);
        console.log('👑 Roll: admin');

    } catch (error) {
        console.error('❌ Fel:', error.message);
        process.exit(1);
    }
}

createAdminUser();
