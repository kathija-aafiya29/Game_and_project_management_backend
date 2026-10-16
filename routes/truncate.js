import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const router = express.Router();

/* =========================================
   SUPABASE CONFIG
========================================= */

const getSupabase = () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase credentials are missing in environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
};

const getCurrentISTForMySQL = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset);
  return istTime.toISOString().slice(0, 19).replace('T', ' ');
};

const getBackupTableSuffix = (month, year) => {
  return `_${month}_${year}`;
};

const isCurrentMonth = (month, year) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  return parseInt(year) === currentYear && month === currentMonth;
};

const tableExists = async (tableName) => {
  try {
    if (!tableName || tableName === 'undefined') return false;
    const supabase = getSupabase();
    // Check if table exists by trying to select 1 row
    const { data, error } = await supabase
      .from(tableName)
      .select('*', { count: 'exact', head: true })
      .limit(1);
    
    return !error;
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error);
    return false;
  }
};

const getGameNamesFromIds = async (gameIds) => {
  if (!gameIds || gameIds.length === 0) return [];
  
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('gameinfodetails')
    .select('id, name')
    .in('id', gameIds);

  if (error) throw error;
  return data || [];
};

router.get('/operators', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('gameoperatordetails')
      .select('name')
      .not('name', 'is', null)
      .neq('name', '')
      .eq('delete_status', 0)
      .order('name');

    if (error) throw error;

    const operators = data.map(item => item.name);
    operators.unshift('all');
    
    res.json({ success: true, data: operators });
  } catch (error) {
    console.error('Error fetching operators:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/games', async (req, res) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('gameinfodetails')
      .select('id, name')
      .not('id', 'is', null)
      .not('name', 'is', null)
      .order('name');

    if (error) throw error;

    const games = data.map(item => ({ id: item.id, name: item.name }));
    games.unshift({ id: 'all', name: 'all' });
    res.json({ success: true, data: games });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/preview', async (req, res) => {
  const supabase = getSupabase();
  
  try {
    const { operator, games, year, month, fromDate, toDate, useDateRange } = req.body;

    let recordCount = 0;
    let tables = [];
    let cleanupMode = useDateRange ? "Date-Based Cleanup" : "Full Cleanup";

    console.log('Preview request:', { operator, games, year, month, fromDate, toDate, useDateRange });

    const gameIds = games.filter(g => g !== 'all');
    let gameIdsList = [];
    let gameNamesList = [];
    const isAllGamesSelected = games.includes('all');
    
    if (gameIds.length > 0) {
      const gameInfo = await getGameNamesFromIds(gameIds);
      gameIdsList = gameInfo.map(g => g.id);
      gameNamesList = gameInfo.map(g => g.name);
      console.log('Game IDs from frontend:', gameIds);
      console.log('Game IDs found:', gameIdsList);
      console.log('Game Names found:', gameNamesList);
    }

    if (!useDateRange) {
      if (operator === 'all' && games.includes('all')) {
        const liveTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'matchcreatelambda',
          'gameusertransactiondetails',
          'gameuserdetails',
          'gameuserdetailslootrix'
        ];
        
        for (const table of liveTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck) {
            const { data, error } = await supabase
              .from(table)
              .select('*', { count: 'exact', head: true });
            
            if (!error && data) {
              const { count } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true });
              recordCount += count || 0;
              tables.push(table);
              console.log(`Count from ${table}: ${count || 0}`);
            }
          }
        }
        
        // Get backup tables - Supabase doesn't have information_schema, so we need to check each pattern
        const backupPatterns = [
          'gameoperatorbetdetailsoverview_',
          'gameuserbetdetails_',
          'gameuserbetdetailsoverview_',
          'matchcreatelambda_',
          'gameusertransactiondetails_'
        ];
        
        let backupTablesFound = 0;
        for (const pattern of backupPatterns) {
          // In Supabase, we can't list tables dynamically, so we'll check based on month/year patterns
          // This is a limitation - you'd need to know the exact table names or use a different approach
          // For now, we'll skip backup table counting as Supabase doesn't support dynamic table listing
          // You may need to maintain a list of backup table names in your application
        }
        
        if (backupTablesFound > 0) {
          tables.push(`${backupTablesFound} backup tables (matching patterns)`);
        }
      } 
      else if (isAllGamesSelected && operator !== 'all') {
        // User selected specific operator with "all" games
        console.log('All games selected for specific operator:', operator);
        
        const liveTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'matchcreatelambda',
          'gameusertransactiondetails',
          'gameuserdetails',
          'gameuserdetailslootrix'
        ];
        
        for (const table of liveTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck) {
            const { data, error } = await supabase
              .from(table)
              .select('*', { count: 'exact', head: true })
              .eq('operator', operator);
            
            if (!error) {
              const { count } = await supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .eq('operator', operator);
              recordCount += count || 0;
              tables.push(table);
              console.log(`Count from ${table} for operator ${operator}: ${count || 0}`);
            }
          }
        }
      }
      else {
        // Specific games selected
        if (gameIdsList.length === 0 && gameNamesList.length === 0) {
          return res.status(400).json({ success: false, message: 'Please select at least one valid game' });
        }
        
        const gameIdTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'gameusertransactiondetails'
        ];
        
        const gameNameTables = ['matchcreatelambda'];
        
        const userMasterTables = [
          { table: 'gameuserdetails', column: 'gamename' },
          { table: 'gameuserdetailslootrix', column: 'gamename' }
        ];
        
        for (const table of gameIdTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck && gameIdsList.length > 0) {
            let query = supabase
              .from(table)
              .select('*', { count: 'exact', head: true })
              .eq('operator', operator)
              .in('game_id', gameIdsList);
            
            const { data, error } = await query;
            if (!error) {
              const { count } = await query;
              recordCount += count || 0;
              tables.push(table);
            }
          }
        }
        
        for (const table of gameNameTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck && gameNamesList.length > 0) {
            let query = supabase
              .from(table)
              .select('*', { count: 'exact', head: true })
              .eq('operator', operator)
              .in('game_name', gameNamesList);
            
            const { data, error } = await query;
            if (!error) {
              const { count } = await query;
              recordCount += count || 0;
              tables.push(table);
            }
          }
        }
        
        for (const { table, column } of userMasterTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck && gameNamesList.length > 0) {
            let query = supabase
              .from(table)
              .select('*', { count: 'exact', head: true })
              .eq('operator', operator)
              .in(column, gameNamesList);
            
            const { data, error } = await query;
            if (!error) {
              const { count } = await query;
              recordCount += count || 0;
              tables.push(table);
            }
          }
        }
      }
    } else {
      // Date-Based Cleanup
      if (!month || !year) {
        return res.status(400).json({ success: false, message: 'Month and Year are required for date-based cleanup' });
      }
      
      const isCurrent = isCurrentMonth(month, year);
      const suffix = getBackupTableSuffix(month, year);
      
      let dateCondition = {};
      if (fromDate && toDate) {
        dateCondition = { gte: fromDate, lte: toDate };
      } else if (fromDate) {
        dateCondition = { gte: fromDate };
      } else if (toDate) {
        dateCondition = { lte: toDate };
      }
      
      if (isCurrent) {
        const gameIdTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'gameusertransactiondetails'
        ];
        
        const gameNameTables = ['matchcreatelambda'];
        
        if (isAllGamesSelected && operator !== 'all') {
          // ALL games selected for specific operator
          for (const table of gameIdTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck) {
              let query = supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .eq('operator', operator);
              
              if (Object.keys(dateCondition).length > 0) {
                query = query.filter('create_at', dateCondition);
              }
              
              const { data, error } = await query;
              if (!error) {
                const { count } = await query;
                recordCount += count || 0;
                tables.push(table);
                console.log(`Count from ${table} for operator ${operator} (ALL GAMES): ${count || 0}`);
              }
            }
          }
          
          for (const table of gameNameTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck) {
              let query = supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .eq('operator', operator);
              
              if (Object.keys(dateCondition).length > 0) {
                query = query.filter('create_at', dateCondition);
              }
              
              const { data, error } = await query;
              if (!error) {
                const { count } = await query;
                recordCount += count || 0;
                tables.push(table);
                console.log(`Count from ${table} for operator ${operator} (ALL GAMES): ${count || 0}`);
              }
            }
          }
        } 
        else if (!isAllGamesSelected && gameIdsList.length > 0) {
          // Specific games selected
          for (const table of gameIdTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck && gameIdsList.length > 0) {
              let query = supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .eq('operator', operator)
                .in('game_id', gameIdsList);
              
              if (Object.keys(dateCondition).length > 0) {
                query = query.filter('create_at', dateCondition);
              }
              
              const { data, error } = await query;
              if (!error) {
                const { count } = await query;
                recordCount += count || 0;
                tables.push(table);
              }
            }
          }
          
          for (const table of gameNameTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck && gameNamesList.length > 0) {
              let query = supabase
                .from(table)
                .select('*', { count: 'exact', head: true })
                .eq('operator', operator)
                .in('game_name', gameNamesList);
              
              if (Object.keys(dateCondition).length > 0) {
                query = query.filter('create_at', dateCondition);
              }
              
              const { data, error } = await query;
              if (!error) {
                const { count } = await query;
                recordCount += count || 0;
                tables.push(table);
              }
            }
          }
        }
      } else {
        // Archived month - work on backup tables
        const backupTableNames = [
          `gameoperatorbetdetailsoverview${suffix}`,
          `gameuserbetdetails${suffix}`,
          `gameuserbetdetailsoverview${suffix}`,
          `matchcreatelambda${suffix}`,
          `gameusertransactiondetails${suffix}`
        ];
        
        if (isAllGamesSelected && operator !== 'all') {
          // ALL games selected for specific operator on archived month
          for (const tableName of backupTableNames) {
            const tableCheck = await tableExists(tableName);
            if (tableCheck) {
              let query = supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true })
                .eq('operator', operator);
              
              if (Object.keys(dateCondition).length > 0) {
                query = query.filter('create_at', dateCondition);
              }
              
              const { data, error } = await query;
              if (!error) {
                const { count } = await query;
                recordCount += count || 0;
                tables.push(tableName);
                console.log(`Count from ${tableName} for operator ${operator} (ALL GAMES): ${count || 0}`);
              }
            }
          }
        } 
        else if (!isAllGamesSelected && gameIdsList.length > 0) {
          // Specific games selected
          for (const tableName of backupTableNames) {
            const tableCheck = await tableExists(tableName);
            if (tableCheck) {
              let query = supabase
                .from(tableName)
                .select('*', { count: 'exact', head: true })
                .eq('operator', operator);
              
              if (tableName.includes('matchcreatelambda')) {
                if (gameNamesList.length > 0) {
                  query = query.in('game_name', gameNamesList);
                }
              } else if (tableName.includes('gameuserbetdetails') || tableName.includes('gameoperatorbetdetailsoverview') || tableName.includes('gameusertransactiondetails')) {
                if (gameIdsList.length > 0) {
                  query = query.in('game_id', gameIdsList);
                }
              }
              
              if (Object.keys(dateCondition).length > 0) {
                query = query.filter('create_at', dateCondition);
              }
              
              const { data, error } = await query;
              if (!error) {
                const { count } = await query;
                recordCount += count || 0;
                tables.push(tableName);
              }
            }
          }
        }
        
        if (tables.length === 0) {
          return res.status(404).json({ 
            success: false, 
            message: `No backup tables found for ${month}/${year}. The data may have already been cleaned up or the month is in the future.` 
          });
        }
      }
    }
    
    res.json({
      success: true,
      data: {
        operator,
        games: games.join(', '),
        cleanupMode,
        month: month || 'N/A',
        year: year || 'N/A',
        fromDate: fromDate || 'Any',
        toDate: toDate || 'Any',
        tables: tables.join(', '),
        recordCount
      }
    });
    
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/truncate', async (req, res) => {
  const supabase = getSupabase();
  
  try {
    const { operator, games, year, month, fromDate, toDate, useDateRange, username, email } = req.body;
    
    let logs = [];
    let totalRecordsDeleted = 0;
    const executedAt = getCurrentISTForMySQL();
    
    console.log('Truncate request:', { operator, games, year, month, fromDate, toDate, useDateRange });
    
    const gameIds = games.filter(g => g !== 'all');
    let gameIdsList = [];
    let gameNamesList = [];
    const isAllGamesSelected = games.includes('all');
    
    if (gameIds.length > 0) {
      const gameInfo = await getGameNamesFromIds(gameIds);
      gameIdsList = gameInfo.map(g => g.id);
      gameNamesList = gameInfo.map(g => g.name);
      console.log('Game IDs from frontend:', gameIds);
      console.log('Game IDs found:', gameIdsList);
      console.log('Game Names found:', gameNamesList);
    }
    
    if (!useDateRange) {
      if (operator === 'all' && games.includes('all')) {
        const liveTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'matchcreatelambda',
          'gameusertransactiondetails',
          'gameuserdetails',
          'gameuserdetailslootrix'
        ];
        
        for (const table of liveTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck) {
            const { error } = await supabase
              .from(table)
              .delete()
              .neq('id', '0'); // Delete all rows
            
            if (!error) {
              logs.push(`Truncated table: ${table}`);
              console.log(`Truncated table: ${table}`);
            } else {
              logs.push(`Failed to truncate table: ${table}`);
            }
          } else {
            logs.push(`Table ${table} does not exist, skipping`);
          }
        }
        
        // Note: Supabase doesn't support DROP TABLE operations through the API
        // You would need to use Supabase SQL Editor or Management API for this
        logs.push('Backup table dropping is not supported via Supabase API. Please use Supabase SQL Editor.');
        
      } 
      else if (isAllGamesSelected && operator !== 'all') {
        // Delete ALL data for specific operator (all games)
        console.log('Deleting all data for operator:', operator);
        
        const liveTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'matchcreatelambda',
          'gameusertransactiondetails',
          'gameuserdetails',
          'gameuserdetailslootrix'
        ];
        
        for (const table of liveTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck) {
            const { data, error } = await supabase
              .from(table)
              .delete()
              .eq('operator', operator)
              .select();
            
            if (!error) {
              const deletedCount = data ? data.length : 0;
              totalRecordsDeleted += deletedCount;
              logs.push(`Deleted ${deletedCount} records from ${table} for operator ${operator} (ALL GAMES)`);
              console.log(`Deleted ${deletedCount} records from ${table}`);
            } else {
              logs.push(`Failed to delete from ${table}: ${error.message}`);
            }
          } else {
            logs.push(`Table ${table} does not exist, skipping`);
          }
        }
      }
      else {
        // Specific games selected
        if (gameIdsList.length === 0 && gameNamesList.length === 0) {
          throw new Error('Please select at least one valid game');
        }
        
        const gameIdTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'gameusertransactiondetails'
        ];
        
        const gameNameTables = ['matchcreatelambda'];
        
        const userMasterTables = [
          { table: 'gameuserdetails', column: 'gamename' },
          { table: 'gameuserdetailslootrix', column: 'gamename' }
        ];
        
        for (const table of gameIdTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck && gameIdsList.length > 0) {
            const { data, error } = await supabase
              .from(table)
              .delete()
              .eq('operator', operator)
              .in('game_id', gameIdsList)
              .select();
            
            if (!error) {
              const deletedCount = data ? data.length : 0;
              totalRecordsDeleted += deletedCount;
              logs.push(`Deleted ${deletedCount} records from ${table} (by game_id)`);
            } else {
              logs.push(`Failed to delete from ${table}: ${error.message}`);
            }
          } else {
            logs.push(`Table ${table} does not exist or no games selected, skipping`);
          }
        }
        
        for (const table of gameNameTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck && gameNamesList.length > 0) {
            const { data, error } = await supabase
              .from(table)
              .delete()
              .eq('operator', operator)
              .in('game_name', gameNamesList)
              .select();
            
            if (!error) {
              const deletedCount = data ? data.length : 0;
              totalRecordsDeleted += deletedCount;
              logs.push(`Deleted ${deletedCount} records from ${table} (by game_name)`);
            } else {
              logs.push(`Failed to delete from ${table}: ${error.message}`);
            }
          } else {
            logs.push(`Table ${table} does not exist or no games selected, skipping`);
          }
        }
        
        for (const { table, column } of userMasterTables) {
          const tableCheck = await tableExists(table);
          if (tableCheck && gameNamesList.length > 0) {
            const { data, error } = await supabase
              .from(table)
              .delete()
              .eq('operator', operator)
              .in(column, gameNamesList)
              .select();
            
            if (!error) {
              const deletedCount = data ? data.length : 0;
              totalRecordsDeleted += deletedCount;
              logs.push(`Deleted ${deletedCount} records from ${table} (by ${column})`);
            } else {
              logs.push(`Failed to delete from ${table}: ${error.message}`);
            }
          } else {
            logs.push(`Table ${table} does not exist or no games selected, skipping`);
          }
        }
      }
    } else {
      // Date-Based Cleanup
      if (!month || !year) {
        throw new Error('Month and Year are required for date-based cleanup');
      }
      
      const isCurrent = isCurrentMonth(month, year);
      const suffix = getBackupTableSuffix(month, year);
      
      let dateCondition = {};
      if (fromDate && toDate) {
        dateCondition = { gte: fromDate, lte: toDate };
      } else if (fromDate) {
        dateCondition = { gte: fromDate };
      } else if (toDate) {
        dateCondition = { lte: toDate };
      }
      
      if (isCurrent) {
        const gameIdTables = [
          'gameoperatorbetdetailsoverview',
          'gameuserbetdetails',
          'gameuserbetdetailsoverview',
          'gameusertransactiondetails'
        ];
        
        const gameNameTables = ['matchcreatelambda'];
        
        if (isAllGamesSelected && operator !== 'all') {
          // ALL games selected for specific operator
          for (const table of gameIdTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck) {
              let query = supabase
                .from(table)
                .delete()
                .eq('operator', operator)
                .filter('create_at', dateCondition)
                .select();
              
              const { data, error } = await query;
              if (!error) {
                const deletedCount = data ? data.length : 0;
                totalRecordsDeleted += deletedCount;
                logs.push(`Deleted ${deletedCount} records from ${table} (ALL GAMES) with date filter`);
                console.log(`Deleted ${deletedCount} records from ${table}`);
              } else {
                logs.push(`Failed to delete from ${table}: ${error.message}`);
              }
            } else {
              logs.push(`Table ${table} does not exist, skipping`);
            }
          }
          
          for (const table of gameNameTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck) {
              let query = supabase
                .from(table)
                .delete()
                .eq('operator', operator)
                .filter('create_at', dateCondition)
                .select();
              
              const { data, error } = await query;
              if (!error) {
                const deletedCount = data ? data.length : 0;
                totalRecordsDeleted += deletedCount;
                logs.push(`Deleted ${deletedCount} records from ${table} (ALL GAMES) with date filter`);
                console.log(`Deleted ${deletedCount} records from ${table}`);
              } else {
                logs.push(`Failed to delete from ${table}: ${error.message}`);
              }
            } else {
              logs.push(`Table ${table} does not exist, skipping`);
            }
          }
        } 
        else if (!isAllGamesSelected && gameIdsList.length > 0) {
          // Specific games selected
          for (const table of gameIdTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck && gameIdsList.length > 0) {
              let query = supabase
                .from(table)
                .delete()
                .eq('operator', operator)
                .in('game_id', gameIdsList)
                .filter('create_at', dateCondition)
                .select();
              
              const { data, error } = await query;
              if (!error) {
                const deletedCount = data ? data.length : 0;
                totalRecordsDeleted += deletedCount;
                logs.push(`Deleted ${deletedCount} records from ${table} (by game_id) with date filter`);
              } else {
                logs.push(`Failed to delete from ${table}: ${error.message}`);
              }
            } else {
              logs.push(`Table ${table} does not exist or no games selected, skipping`);
            }
          }
          
          for (const table of gameNameTables) {
            const tableCheck = await tableExists(table);
            if (tableCheck && gameNamesList.length > 0) {
              let query = supabase
                .from(table)
                .delete()
                .eq('operator', operator)
                .in('game_name', gameNamesList)
                .filter('create_at', dateCondition)
                .select();
              
              const { data, error } = await query;
              if (!error) {
                const deletedCount = data ? data.length : 0;
                totalRecordsDeleted += deletedCount;
                logs.push(`Deleted ${deletedCount} records from ${table} (by game_name) with date filter`);
              } else {
                logs.push(`Failed to delete from ${table}: ${error.message}`);
              }
            } else {
              logs.push(`Table ${table} does not exist or no games selected, skipping`);
            }
          }
        }
      } else {
        // Archived month - work on backup tables
        const backupTableNames = [
          `gameoperatorbetdetailsoverview${suffix}`,
          `gameuserbetdetails${suffix}`,
          `gameuserbetdetailsoverview${suffix}`,
          `matchcreatelambda${suffix}`,
          `gameusertransactiondetails${suffix}`
        ];
        
        let hasBackupTables = false;
        
        if (isAllGamesSelected && operator !== 'all') {
          // ALL games selected for specific operator on archived month
          for (const tableName of backupTableNames) {
            const tableCheck = await tableExists(tableName);
            if (tableCheck) {
              hasBackupTables = true;
              let query = supabase
                .from(tableName)
                .delete()
                .eq('operator', operator)
                .filter('create_at', dateCondition)
                .select();
              
              const { data, error } = await query;
              if (!error) {
                const deletedCount = data ? data.length : 0;
                totalRecordsDeleted += deletedCount;
                logs.push(`Deleted ${deletedCount} records from ${tableName} (ALL GAMES) with date filter`);
                console.log(`Deleted ${deletedCount} records from ${tableName}`);
              } else {
                logs.push(`Failed to delete from ${tableName}: ${error.message}`);
              }
            }
          }
        } 
        else if (!isAllGamesSelected && gameIdsList.length > 0) {
          // Specific games selected
          for (const tableName of backupTableNames) {
            const tableCheck = await tableExists(tableName);
            if (tableCheck) {
              hasBackupTables = true;
              let query = supabase
                .from(tableName)
                .delete()
                .eq('operator', operator)
                .filter('create_at', dateCondition);
              
              if (tableName.includes('matchcreatelambda')) {
                if (gameNamesList.length > 0) {
                  query = query.in('game_name', gameNamesList);
                }
              } else if (tableName.includes('gameuserbetdetails') || tableName.includes('gameoperatorbetdetailsoverview') || tableName.includes('gameusertransactiondetails')) {
                if (gameIdsList.length > 0) {
                  query = query.in('game_id', gameIdsList);
                }
              }
              
              query = query.select();
              const { data, error } = await query;
              if (!error) {
                const deletedCount = data ? data.length : 0;
                totalRecordsDeleted += deletedCount;
                if (tableName.includes('matchcreatelambda')) {
                  logs.push(`Deleted ${deletedCount} records from ${tableName} (by game_name) with date filter`);
                } else {
                  logs.push(`Deleted ${deletedCount} records from ${tableName} (by game_id) with date filter`);
                }
              } else {
                logs.push(`Failed to delete from ${tableName}: ${error.message}`);
              }
            }
          }
        }
        
        if (!hasBackupTables) {
          throw new Error(`No backup tables found for ${month}/${year}. The data may have already been cleaned up or the month is in the future.`);
        }
      }
    }
    
    // Create audit_logs table if it doesn't exist
    // Note: This would need to be done through Supabase SQL Editor or migrations
    // The following code attempts to create the table but may not work if RLS is enabled
    try {
      // Check if audit_logs table exists
      const tableExists = await supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .limit(1);
      
      if (tableExists.error) {
        // Table doesn't exist, create it (this may not work with RLS)
        // You should create this table in Supabase SQL Editor
        logs.push('audit_logs table does not exist. Please create it in Supabase SQL Editor.');
      }
    } catch (err) {
      logs.push('audit_logs table may not exist. Please create it in Supabase SQL Editor.');
    }
    
    // Insert audit log
    try {
      const { error: auditError } = await supabase
        .from('audit_logs')
        .insert([{
          operation_type: useDateRange ? 'DATE_BASED_CLEANUP' : 'FULL_CLEANUP',
          operator_name: operator,
          game_name: games.join(', '),
          date_filter_status: useDateRange ? 'YES' : 'NO',
          month: month || null,
          year: year || null,
          from_date: fromDate || null,
          to_date: toDate || null,
          tables_affected: logs.join('; '),
          records_deleted: totalRecordsDeleted.toString(),
          executed_by: username || email,
          executed_on: executedAt
        }]);
      
      if (auditError) {
        logs.push(`Failed to insert audit log: ${auditError.message}`);
      }
    } catch (err) {
      logs.push(`Failed to insert audit log: ${err.message}`);
    }
    
    res.json({
      success: true,
      title: useDateRange ? 'Records Deleted' : 'Cleanup Completed',
      message: logs.join('\n'),
      recordsDeleted: totalRecordsDeleted
    });
    
  } catch (error) {
    console.error('Error in truncation process:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;